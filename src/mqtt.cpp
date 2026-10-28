#include "mqtt.h"

#include <Preferences.h>
#include <WiFi.h>
#include <mqtt_client.h>

#include "climate.h"
#include "device.h"
#include "eventlog.h"
#include "lock.h"
#include "radar.h"

namespace mqtt {
namespace {

constexpr uint32_t MEASURE_EVERY_MS = 2000;  // distance, climate and light at most this often
constexpr uint32_t HEARTBEAT_MS = 60000;     // full state (with RSSI) even without changes
constexpr const char *NVS = "sense-mqtt";
constexpr const char *PROTOTYPE_NVS = "whisli-mqtt";  // same keys; read once after the prototype

// What gets published, copied under StateLock
struct Snapshot {
  String name;
  uint32_t nameVersion = 0;
  int presence = -1, distanceCm = -1;
  climate::Reading climate;
};

// Shared (StateLock)
Settings saved;
bool restartPending = false;

// loop() only. The client keeps pointers to these strings for its whole life.
Settings current;
esp_mqtt_client_handle_t client = nullptr;
String base, nodeId, willTopic, haStatusTopic;
uint32_t announcedName = 0;

// Written by the esp-mqtt task
volatile bool connected = false;
volatile bool resync = false;  // just connected or HA restarted: announce everything again
portMUX_TYPE statusMux = portMUX_INITIALIZER_UNLOCKED;
const char *currentState = "disabled";
const char *errorCode = "";

uint32_t published = 0, connects = 0;  // for diagnostics

void setStatus(const char *state, const char *error = "") {
  portENTER_CRITICAL(&statusMux);
  currentState = state;
  errorCode = error;
  portEXIT_CRITICAL(&statusMux);
}

String baseOf(const Settings &s) { return s.baseTopic.length() ? s.baseTopic : defaultBaseTopic(); }

String quote(const String &text) {
  String out = "\"";
  for (char c : text) {
    if (c == '"' || c == '\\') out += '\\';
    if ((uint8_t)c >= 0x20) out += c;
  }
  return out + '"';
}

const char *errorOf(const esp_mqtt_error_codes_t *e) {
  if (e && e->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
    const bool credentials = e->connect_return_code == MQTT_CONNECTION_REFUSE_BAD_USERNAME ||
                             e->connect_return_code == MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED;
    return credentials ? "credentials" : "refused";
  }
  if (e && e->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) return "unreachable";
  return "failed";
}

void onEvent(void *, esp_event_base_t, int32_t id, void *data) {
  auto event = static_cast<esp_mqtt_event_handle_t>(data);
  switch (id) {
    case MQTT_EVENT_CONNECTED:
      connects++;
      eventlog::info("mqtt", "mqttConnected");
      connected = true;
      resync = true;
      setStatus("connected");
      esp_mqtt_client_subscribe(event->client, haStatusTopic.c_str(), 0);
      break;
    case MQTT_EVENT_DISCONNECTED:
      if (connected) eventlog::warning("mqtt", "mqttLost");
      connected = false;
      if (strcmp(currentState, "error") != 0) setStatus("connecting");
      break;
    case MQTT_EVENT_ERROR:
      if (strcmp(currentState, "error") != 0) eventlog::error("mqtt", "mqttError", errorOf(event->error_handle));  // once, not every retry
      setStatus("error", errorOf(event->error_handle));
      break;
    case MQTT_EVENT_DATA:
      // HA restarted and forgot non-retained states
      if (event->data_len == 6 && !strncmp(event->data, "online", 6)) resync = true;
      break;
    default:
      break;
  }
}

void enqueue(const String &topic, const String &payload, bool retain) {
  esp_mqtt_client_enqueue(client, topic.c_str(), payload.c_str(), payload.length(), 1, retain, true);
  published++;
}

struct Entity {
  const char *component, *key, *name, *deviceClass, *unit;
  bool diagnostic;
};
// unique_id = <nodeId>_<key>; never change the keys or HA loses the entities.
// Names are English in every panel language (HA users translate or rename them there).
const Entity ENTITIES[] = {
    {"binary_sensor", "occupancy", "Occupancy", "occupancy", nullptr, false},
    {"sensor", "distance", "Distance", "distance", "m", false},
    {"sensor", "temperature", "Temperature", "temperature", "°C", false},
    {"sensor", "humidity", "Humidity", "humidity", "%", false},
    {"sensor", "lux", "Illuminance", "illuminance", "lx", false},
    {"sensor", "rssi", "Wi-Fi signal", "signal_strength", "dBm", true},
};

void publishDiscovery(const Snapshot &now) {
  const String device = "{\"identifiers\":[\"" + nodeId + "\"],\"name\":" + quote(now.name) +
                        ",\"manufacturer\":\"Whisli\",\"model\":\"Whisli Sense\",\"configuration_url\":\"http://" +
                        WiFi.localIP().toString() + "/\"}";
  for (const Entity &e : ENTITIES) {
    const String topic = current.discoveryPrefix + "/" + e.component + "/" + nodeId + "/" + e.key + "/config";
    if (!current.discovery) {  // an empty retained message removes the entity from HA
      enqueue(topic, "", true);
      continue;
    }
    String json = "{\"name\":" + quote(e.name) + ",\"unique_id\":\"" + nodeId + "_" + e.key +
                  "\",\"state_topic\":\"" + base + "/state\",\"availability_topic\":\"" + base +
                  "/status\",\"device_class\":\"" + e.deviceClass + "\",\"value_template\":\"{{ value_json." +
                  e.key + " }}\"";
    if (e.unit) json += ",\"unit_of_measurement\":" + quote(e.unit) + ",\"state_class\":\"measurement\"";
    if (e.diagnostic) json += ",\"entity_category\":\"diagnostic\"";
    json += ",\"device\":" + device + "}";
    enqueue(topic, json, true);
  }
}

// Missing readings are null, which HA shows as "unknown"
void publishState(const Snapshot &now) {
  JsonDocument doc;
  if (now.presence < 0) doc["occupancy"] = nullptr;
  else doc["occupancy"] = now.presence ? "ON" : "OFF";
  if (now.distanceCm >= 0) doc["distance"] = serialized(String(now.distanceCm / 100.0f, 2));
  else doc["distance"] = nullptr;
  const climate::Reading &c = now.climate;
  if (c.climateValid) {
    doc["temperature"] = serialized(String(c.temperature, 1));
    doc["humidity"] = serialized(String(c.humidity, 0));
  } else {
    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }
  if (c.lightValid) doc["lux"] = serialized(String(c.lux, 0));
  else doc["lux"] = nullptr;
  doc["rssi"] = WiFi.RSSI();
  String json;
  serializeJson(doc, json);
  enqueue(base + "/state", json, true);
}

// Stops the client. forget: first clear our retained messages (other broker/topic, or disabled).
void stop(bool forget) {
  if (!client) return;
  if (forget && connected) {
    esp_mqtt_client_publish(client, (base + "/status").c_str(), "", 0, 1, true);
    esp_mqtt_client_publish(client, (base + "/state").c_str(), "", 0, 1, true);
  }
  esp_mqtt_client_stop(client);
  esp_mqtt_client_destroy(client);
  client = nullptr;
  connected = false;
}

void start() {
  base = baseOf(current);
  nodeId = "whisli_sense_" + device::id();
  willTopic = base + "/status";
  haStatusTopic = current.discoveryPrefix + "/status";
  esp_mqtt_client_config_t config = {};
  config.broker.address.hostname = current.host.c_str();
  config.broker.address.port = current.port;
  config.broker.address.transport = MQTT_TRANSPORT_OVER_TCP;
  config.credentials.client_id = nodeId.c_str();
  if (current.user.length()) config.credentials.username = current.user.c_str();
  if (current.password.length()) config.credentials.authentication.password = current.password.c_str();
  config.session.last_will.topic = willTopic.c_str();
  config.session.last_will.msg = "offline";
  config.session.last_will.retain = true;
  config.session.last_will.qos = 1;
  config.network.timeout_ms = 5000;
  config.network.reconnect_timeout_ms = 10000;
  config.task.priority = 3;
  config.task.stack_size = 4096;
  config.buffer.size = 1024;
  client = esp_mqtt_client_init(&config);
  if (!client) return setStatus("error", "failed");
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, onEvent, nullptr);
  esp_mqtt_client_start(client);
  setStatus("connecting");
}

bool changed(const Snapshot &a, const Snapshot &b) {
  const climate::Reading &x = a.climate, &y = b.climate;
  if (x.climateValid != y.climateValid || x.lightValid != y.lightValid) return true;
  if (abs(a.distanceCm - b.distanceCm) >= 10) return true;
  if (x.climateValid && (fabsf(x.temperature - y.temperature) >= 0.1f || fabsf(x.humidity - y.humidity) >= 1)) return true;
  return x.lightValid && fabsf(x.lux - y.lux) >= max(1.0f, y.lux * 0.05f);
}

Settings load(const char *ns) {
  Settings s;
  Preferences prefs;
  prefs.begin(ns, true);
  s.enabled = prefs.getBool("enabled", s.enabled);
  s.host = prefs.getString("host", s.host);
  s.port = prefs.getUShort("port", s.port);
  s.user = prefs.getString("user", s.user);
  s.password = prefs.getString("pass", s.password);
  s.baseTopic = prefs.getString("topic", s.baseTopic);
  s.discovery = prefs.getBool("disc", s.discovery);
  s.discoveryPrefix = prefs.getString("discPrefix", s.discoveryPrefix);
  prefs.end();
  return s;
}

bool hasSettings(const char *ns) {
  Preferences prefs;
  const bool found = prefs.begin(ns, true) && prefs.isKey("enabled");
  prefs.end();
  return found;
}

}  // namespace

String defaultBaseTopic() { return "whisli-sense/" + device::id(); }

bool validTopic(const String &t) {
  return t.length() && t.length() <= 64 && !t.startsWith("/") && !t.endsWith("/") && t.indexOf("//") < 0 &&
         t.indexOf('#') < 0 && t.indexOf('+') < 0;
}

void begin() {
  saved = current = load(hasSettings(NVS) || !hasSettings(PROTOTYPE_NVS) ? NVS : PROTOTYPE_NVS);
}

Settings settings() { return saved; }

void save(const Settings &s) {
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putBool("enabled", s.enabled);
  prefs.putString("host", s.host);
  prefs.putUShort("port", s.port);
  prefs.putString("user", s.user);
  prefs.putString("pass", s.password);
  prefs.putString("topic", s.baseTopic);
  prefs.putBool("disc", s.discovery);
  prefs.putString("discPrefix", s.discoveryPrefix);
  prefs.end();
  saved = s;
  restartPending = true;
}

void loop() {
  Snapshot now;
  bool restart;
  Settings next;
  {
    StateLock lock;
    now.name = device::name();
    now.nameVersion = device::nameVersion();
    now.presence = radar::presence();
    now.distanceCm = radar::distanceCm();
    now.climate = climate::reading();
    restart = restartPending;
    restartPending = false;
    next = saved;
  }

  if (restart) {
    const bool moved = next.host != current.host || next.port != current.port || baseOf(next) != base;
    stop(moved || !next.enabled);
    current = next;
    if (!current.enabled || current.host.isEmpty()) setStatus("disabled");
  }
  if (!client && current.enabled && current.host.length() && WiFi.isConnected()) start();
  if (!client || !connected) return;

  static Snapshot sent;
  static uint32_t measuredAt = 0, heartbeatAt = 0;
  const uint32_t t = millis();
  if (resync || now.nameVersion != announcedName) {
    resync = false;
    announcedName = now.nameVersion;
    enqueue(base + "/status", "online", true);
    publishDiscovery(now);
  } else if (now.presence == sent.presence && !(t - measuredAt >= MEASURE_EVERY_MS && changed(now, sent)) &&
             t - heartbeatAt < HEARTBEAT_MS) {
    return;
  }
  publishState(now);
  sent = now;
  measuredAt = heartbeatAt = t;
}

void diagnostics(JsonObject out) {
  out["state"] = state();
  out["error"] = error();
  out["host"] = saved.host;
  out["port"] = saved.port;
  out["base"] = baseOf(saved);
  out["published"] = published;
  out["connects"] = connects;
}

const char *state() {
  portENTER_CRITICAL(&statusMux);
  const char *s = currentState;
  portEXIT_CRITICAL(&statusMux);
  return s;
}

String error() {
  portENTER_CRITICAL(&statusMux);
  const char *e = errorCode;
  portEXIT_CRITICAL(&statusMux);
  return e;
}

}  // namespace mqtt
