#include "web.h"

#include <ESPAsyncWebServer.h>
#include <Update.h>
#include <WiFi.h>

#include <functional>

#include "auth.h"
#include "calibration.h"
#include "climate.h"
#include "device.h"
#include "eventlog.h"
#include "extremes.h"
#include "generated/ui.h"
#include "generated/version.h"
#include "led.h"
#include "lock.h"
#include "mqtt.h"
#include "net.h"
#include "peers.h"
#include "radar.h"
#include "state.h"

namespace web {
namespace {

using Request = AsyncWebServerRequest *;

constexpr uint32_t STATE_EVERY_MS = 1000;
constexpr uint32_t SUMMARY_EVERY_MS = 10000;

AsyncWebServer server(80);
AsyncWebSocket panelSocket("/api/v1/ws");
AsyncWebSocket liveSocket("/api/v1/live");
// Set in the web server task, handled in loop()
volatile bool panelJoined = false, liveJoined = false;
volatile uint32_t restartAt = 0;

// --- Replies ---

void reply(Request r, JsonDocument &doc, int code = 200) {
  String body;
  serializeJson(doc, body);
  r->send(code, "application/json", body);
}

void ok(Request r) {
  JsonDocument doc;
  doc["ok"] = true;
  reply(r, doc);
}

void fail(Request r, int code, const char *error) {
  JsonDocument doc;
  doc["error"] = error;  // the panel translates it
  reply(r, doc, code);
}

enum class Access { open, signedIn };

// Handlers run under StateLock, so they read and change module state directly.
void on(const char *path, WebRequestMethodComposite method, Access access, std::function<void(Request)> handler) {
  server.on(AsyncURIMatcher::exact(path), method, [access, handler](Request r) {
    if (access == Access::signedIn && !auth::allowed(r)) return fail(r, 401, "unauthorized");
    StateLock lock;
    handler(r);
  });
}

// --- Form fields ---

String text(Request r, const char *name) {
  String value = r->hasArg(name) ? r->arg(name) : String();
  value.trim();
  return value;
}

bool flag(Request r, const char *name, bool fallback) {
  if (!r->hasArg(name)) return fallback;
  return r->arg(name) == "1" || r->arg(name) == "true";
}

// Optional whole number: absent leaves `out` as is; false when present but not a number in range.
bool number(Request r, const char *name, long min, long max, int32_t &out) {
  if (!r->hasArg(name)) return true;
  const String &value = r->arg(name);
  char *end;
  const long n = strtol(value.c_str(), &end, 10);
  if (value.isEmpty() || *end || n < min || n > max) return false;
  out = n;
  return true;
}


// --- Routes ---

void authRoutes() {
  on("/api/v1/auth", HTTP_GET, Access::open, [](Request r) {
    JsonDocument doc;
    doc["signedIn"] = auth::allowed(r);
    doc["defaultPassword"] = auth::usingDefault();
    // Shown on the login screen, so you know which sensor you are signing in to
    doc["name"] = device::name();
    doc["hostname"] = device::hostname();
    doc["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
    reply(r, doc);
  });
  on("/api/v1/auth/login", HTTP_POST, Access::open, [](Request r) {
    String token;
    const bool remember = flag(r, "remember", false);
    switch (auth::login(text(r, "password"), remember, token)) {
      case auth::Login::tooSoon: return fail(r, 429, "tooSoon");
      case auth::Login::wrongPassword:
        eventlog::warning("system", "loginFailed", r->client()->remoteIP().toString().c_str());
        return fail(r, 403, "wrongPassword");
      case auth::Login::ok: break;
    }
    AsyncWebServerResponse *res = r->beginResponse(200, "application/json", "{\"ok\":true}");
    res->addHeader("Set-Cookie", String(auth::COOKIE) + "=" + token + "; Path=/; HttpOnly; SameSite=Strict" +
                                     (remember ? "; Max-Age=" + String(auth::REMEMBER_DAYS * 86400UL) : ""));
    r->send(res);
  });
  on("/api/v1/auth/logout", HTTP_POST, Access::open, [](Request r) {
    auth::logout(r);
    AsyncWebServerResponse *res = r->beginResponse(200, "application/json", "{\"ok\":true}");
    res->addHeader("Set-Cookie", String(auth::COOKIE) + "=; Path=/; Max-Age=0");
    r->send(res);
  });
  on("/api/v1/auth/password", HTTP_POST, Access::signedIn, [](Request r) {
    const String next = text(r, "password");
    if (next.length() < 8 || next.length() > 64) return fail(r, 400, "passwordLength");
    if (!auth::changePassword(text(r, "current"), next)) return fail(r, 403, "wrongPassword");
    eventlog::info("system", "passwordChanged");
    ok(r);
  });
}

void sensorRoutes() {
  on("/api/v1/state", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    state::full(doc.to<JsonObject>());
    reply(r, doc);
  });
  on("/api/v1/peers", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    peers::list(doc.to<JsonArray>());
    reply(r, doc);
  });
  on("/api/v1/device", HTTP_POST, Access::signedIn, [](Request r) {
    if (!device::setName(text(r, "name"))) return fail(r, 400, "invalidName");
    eventlog::info("system", "renamed", device::name().c_str());
    JsonDocument doc;
    doc["hostname"] = device::hostname();
    reply(r, doc);
  });

  // Fields, all optional: minGate, maxGate (0-15), delay (s, 0-600), p0..p15 (presence threshold:
  // hold = p, trigger = 1.5 × p), t0..t15 / h0..h15 (trigger / hold directly, 0-65535),
  // factory=1 (factory thresholds). Written in the background; see "busy" in the state.
  on("/api/v1/radar", HTTP_POST, Access::signedIn, [](Request r) {
    if (!radar::settingsLoaded()) return fail(r, 409, "radarNotReady");
    radar::Change change;
    if (flag(r, "factory", false)) change.thresholds(radar::FACTORY_TRIGGER, radar::FACTORY_HOLD);
    bool valid = number(r, "minGate", 0, radar::GATES - 1, change.minGate) &&
                 number(r, "maxGate", 0, radar::GATES - 1, change.maxGate) &&
                 number(r, "delay", 0, radar::MAX_DELAY_S, change.delay);
    for (uint8_t g = 0; g < radar::GATES; g++) {
      const String trigger = "t" + String(g), hold = "h" + String(g), presence = "p" + String(g);
      int32_t threshold = -1;
      valid = valid && number(r, presence.c_str(), 1, radar::MAX_THRESHOLD, threshold) &&
              number(r, trigger.c_str(), 0, radar::MAX_THRESHOLD, change.trigger[g]) &&
              number(r, hold.c_str(), 0, radar::MAX_THRESHOLD, change.hold[g]);
      if (threshold > 0 && change.trigger[g] < 0 && change.hold[g] < 0) change.presence(g, threshold);
    }
    const radar::Settings &now = radar::settings();
    const int32_t minGate = change.minGate >= 0 ? change.minGate : now.minGate;
    const int32_t maxGate = change.maxGate >= 0 ? change.maxGate : now.maxGate;
    if (!valid || minGate > maxGate) return fail(r, 400, "invalid");
    radar::apply(change);
    ok(r);
  });

  // action: start (optional leave, empty, back, still in s and margin in %), seated, cancel, undo
  on("/api/v1/calibration", HTTP_POST, Access::signedIn, [](Request r) {
    const String action = text(r, "action");
    if (action == "start") {
      calibration::Options o;
      int32_t leave = o.leaveS, empty = o.emptyS, back = o.backS, still = o.stillS, margin = o.marginPct;
      if (!number(r, "leave", 0, 120, leave) || !number(r, "empty", 10, 300, empty) ||
          !number(r, "back", 5, 120, back) || !number(r, "still", 10, 60, still) ||
          !number(r, "margin", 5, 500, margin))
        return fail(r, 400, "invalid");
      o = {(uint16_t)leave, (uint16_t)empty, (uint16_t)back, (uint16_t)still, (uint16_t)margin};
      if (!calibration::start(o)) return fail(r, 409, "radarNotReady");
    } else if (action == "seated") {
      calibration::seated();
    } else if (action == "cancel") {
      calibration::cancel();
    } else if (action == "undo") {
      if (!calibration::undo()) return fail(r, 409, "nothingToUndo");
    } else {
      return fail(r, 400, "invalid");
    }
    ok(r);
  });
}

void networkRoutes() {
  on("/api/v1/wifi", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    net::status(doc.to<JsonObject>());
    reply(r, doc);
  });
  on("/api/v1/wifi", HTTP_POST, Access::signedIn, [](Request r) {
    const String ssid = text(r, "ssid"), password = r->hasArg("password") ? r->arg("password") : String();
    if (ssid.isEmpty() || ssid.length() > 32) return fail(r, 400, "invalidSsid");
    if (password.length() && (password.length() < 8 || password.length() > 63)) return fail(r, 400, "wifiPasswordLength");
    net::connect(ssid, password);
    ok(r);
  });
  on("/api/v1/wifi/forget", HTTP_POST, Access::signedIn, [](Request r) {
    net::forget();
    ok(r);
  });
  on("/api/v1/wifi/scan", HTTP_POST, Access::signedIn, [](Request r) {
    net::startScan();
    ok(r);
  });
  on("/api/v1/wifi/scan", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    net::scanResults(doc.to<JsonObject>());
    reply(r, doc);
  });
  on("/api/v1/wifi/ap", HTTP_POST, Access::signedIn, [](Request r) {
    const String password = r->hasArg("password") ? r->arg("password") : String();
    if (password.length() < 8 || password.length() > 63) return fail(r, 400, "wifiPasswordLength");
    net::setApPassword(password);
    ok(r);
  });

  // The password never leaves the sensor; GET only says whether one is set.
  on("/api/v1/mqtt", HTTP_GET, Access::signedIn, [](Request r) {
    const mqtt::Settings s = mqtt::settings();
    JsonDocument doc;
    doc["enabled"] = s.enabled;
    doc["host"] = s.host;
    doc["port"] = s.port;
    doc["user"] = s.user;
    doc["hasPassword"] = !s.password.isEmpty();
    doc["baseTopic"] = s.baseTopic;
    doc["defaultBaseTopic"] = mqtt::defaultBaseTopic();
    doc["discovery"] = s.discovery;
    doc["discoveryPrefix"] = s.discoveryPrefix;
    doc["state"] = mqtt::state();
    doc["error"] = mqtt::error();
    reply(r, doc);
  });
  // Fields, all optional: enabled, host, port, user, password, clearPassword, baseTopic, discovery,
  // discoveryPrefix
  on("/api/v1/mqtt", HTTP_POST, Access::signedIn, [](Request r) {
    mqtt::Settings s = mqtt::settings();
    int32_t port = s.port;
    s.enabled = flag(r, "enabled", s.enabled);
    if (r->hasArg("host")) s.host = text(r, "host");
    if (r->hasArg("user")) s.user = text(r, "user");
    if (r->hasArg("password")) s.password = r->arg("password");
    if (flag(r, "clearPassword", false)) s.password = "";
    if (r->hasArg("baseTopic")) s.baseTopic = text(r, "baseTopic");
    s.discovery = flag(r, "discovery", s.discovery);
    if (r->hasArg("discoveryPrefix")) s.discoveryPrefix = text(r, "discoveryPrefix");
    if (!number(r, "port", 1, 65535, port)) return fail(r, 400, "invalidPort");
    s.port = port;
    if (s.enabled && s.host.isEmpty()) return fail(r, 400, "invalidHost");
    if (s.host.length() > 64 || s.user.length() > 64 || s.password.length() > 64) return fail(r, 400, "invalid");
    if ((s.baseTopic.length() && !mqtt::validTopic(s.baseTopic)) || !mqtt::validTopic(s.discoveryPrefix))
      return fail(r, 400, "invalidTopic");
    mqtt::save(s);
    eventlog::info("mqtt", "mqttSaved", s.enabled ? s.host.c_str() : "");
    ok(r);
  });
}

void systemRoutes() {
  // Status LED. Fields, all optional: mode (off, status, presence, distance), color (blue, green,
  // white, purple, amber), brightness (1-100 %), alerts, darkOff (1/0). Applied at once.
  on("/api/v1/led", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    led::toJson(led::settings(), doc.to<JsonObject>());
    reply(r, doc);
  });
  on("/api/v1/led", HTTP_POST, Access::signedIn, [](Request r) {
    led::Settings s = led::settings();
    int32_t brightness = s.brightness;
    const String mode = text(r, "mode"), color = text(r, "color");
    if (!led::fromJson(mode.length() ? mode.c_str() : nullptr, color.length() ? color.c_str() : nullptr, s) ||
        !number(r, "brightness", 1, 100, brightness))
      return fail(r, 400, "invalid");
    s.brightness = brightness;
    s.alerts = flag(r, "alerts", s.alerts);
    s.darkOff = flag(r, "darkOff", s.darkOff);
    led::save(s);
    JsonDocument doc;
    led::toJson(s, doc.to<JsonObject>());
    reply(r, doc);
  });
  on("/api/v1/system", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    doc["version"] = FIRMWARE_VERSION;
    doc["id"] = device::id();
    doc["mac"] = WiFi.macAddress();
    doc["chip"] = ESP.getChipModel();
    doc["uptime"] = millis() / 1000;
    doc["resetReason"] = state::resetReason();
    doc["heap"] = ESP.getFreeHeap();
    doc["minHeap"] = ESP.getMinFreeHeap();
    doc["firmwareSize"] = ESP.getSketchSize();
    doc["firmwareSpace"] = ESP.getFreeSketchSpace();
    reply(r, doc);
  });
  on("/api/v1/system/restart", HTTP_POST, Access::signedIn, [](Request r) {
    eventlog::info("system", "restart");
    restartAt = millis() + 500;  // after the reply went out
    ok(r);
  });
  on("/api/v1/diagnostics", HTTP_GET, Access::signedIn, [](Request r) {
    JsonDocument doc;
    climate::diagnostics(doc.to<JsonObject>());
    radar::diagnostics(doc["radar"].to<JsonObject>());
    state::system(doc["system"].to<JsonObject>());
    net::diagnostics(doc["network"].to<JsonObject>());
    mqtt::diagnostics(doc["mqtt"].to<JsonObject>());
    reply(r, doc);
  });
  // Event log, newest last. Optional: after / before (entry id), limit (1-120, default 60),
  // level (info, warning, error), category (system, network, radar, sensors, mqtt).
  on("/api/v1/logs", HTTP_GET, Access::signedIn, [](Request r) {
    int32_t after = 0, before = 0, limit = 60;
    if (!number(r, "after", 0, INT32_MAX, after) || !number(r, "before", 0, INT32_MAX, before) || !number(r, "limit", 1, 120, limit))
      return fail(r, 400, "invalid");
    JsonDocument doc;
    eventlog::toJson(doc.to<JsonObject>(), after, before, limit, text(r, "level").c_str(), text(r, "category").c_str());
    reply(r, doc);
  });

  // New firmware as the raw request body (Content-Type: application/octet-stream), e.g.
  // curl -u whisli:<password> -H "Content-Type: application/octet-stream" --data-binary @firmware.bin
  //   http://<ip>/api/v1/firmware
  // The body arrives in chunks in the web server task; flash writes happen there, outside StateLock.
  server.on(
      AsyncURIMatcher::exact("/api/v1/firmware"), HTTP_POST,
      [](Request r) {
        if (!auth::allowed(r)) return fail(r, 401, "unauthorized");
        if (Update.hasError() || !Update.isFinished()) {
          JsonDocument doc;
          doc["error"] = "firmwareFailed";
          doc["detail"] = Update.errorString();
          return reply(r, doc, 500);
        }
        restartAt = millis() + 1000;
        ok(r);
      },
      nullptr,
      [](Request r, uint8_t *data, size_t length, size_t index, size_t total) {
        if (index == 0) {
          if (!auth::allowed(r)) return;
          Serial.printf("Firmware update: %u B\n", total);
          eventlog::info("system", "firmwareStart", (String(total / 1024) + " KB").c_str());
          if (!Update.begin(total)) eventlog::error("system", "firmwareFailed", Update.errorString());
        }
        if (!Update.isRunning()) return;
        if (Update.write(data, length) != length) Update.printError(Serial);
        if (index + length == total) {
          if (Update.end(true)) eventlog::info("system", "firmwareOk");
          else eventlog::error("system", "firmwareFailed", Update.errorString());
        }
      });
}

void broadcast(AsyncWebSocket &socket, void (*build)(JsonObject)) {
  String json;
  {
    StateLock lock;
    JsonDocument doc;
    build(doc.to<JsonObject>());
    serializeJson(doc, json);
  }
  socket.textAll(json);  // outside StateLock: the socket has its own lock
}

}  // namespace

void begin() {
  server.on(AsyncURIMatcher::exact("/"), HTTP_GET, [](Request r) {
    AsyncWebServerResponse *res = r->beginResponse(200, "text/html", UI_GZ, sizeof(UI_GZ));
    res->addHeader("Content-Encoding", "gzip");
    res->addHeader("Cache-Control", "no-cache");
    r->send(res);
  });

  // Socket event handlers must not take StateLock (the socket's lock may be held); they set flags.
  panelSocket.handleHandshake([](Request r) { return auth::allowed(r); });
  panelSocket.onEvent([](AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *, uint8_t *, size_t) {
    if (type == WS_EVT_CONNECT) panelJoined = true;
  });
  liveSocket.onEvent([](AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *, uint8_t *, size_t) {
    if (type == WS_EVT_CONNECT) liveJoined = true;
  });
  server.addHandler(&panelSocket);
  server.addHandler(&liveSocket);

  authRoutes();
  sensorRoutes();
  networkRoutes();
  systemRoutes();

  server.onNotFound([](Request r) {
    if (r->url().startsWith("/api/")) return fail(r, 404, "notFound");
    r->redirect("/");  // also brings phones on the setup access point to the panel
  });
  server.begin();
}

void loop() {
  static uint32_t stateAt = 0, summaryAt = 0, cleanupAt = 0;
  static int lastPresence = -2;
  const uint32_t now = millis();

  int presence;
  {
    StateLock lock;
    presence = radar::presence();
  }
  const bool presenceChanged = presence != lastPresence;
  lastPresence = presence;

  if (panelSocket.count() && (presenceChanged || panelJoined || now - stateAt >= STATE_EVERY_MS)) {
    panelJoined = false;
    stateAt = now;
    broadcast(panelSocket, state::full);
  }
  if (liveSocket.count() && (presenceChanged || liveJoined || now - summaryAt >= SUMMARY_EVERY_MS)) {
    liveJoined = false;
    summaryAt = now;
    broadcast(liveSocket, state::summary);
  }
  if (now - cleanupAt >= 1000) {
    cleanupAt = now;
    panelSocket.cleanupClients();
    liveSocket.cleanupClients();
  }
  if (restartAt && (int32_t)(now - restartAt) >= 0) {
    extremes::save();  // an update or restart would otherwise lose up to 10 min of them
    ESP.restart();
  }
}

}  // namespace web
