#pragma once
// Home Assistant over MQTT (optional - the sensor works the same without a broker).
// MQTT Discovery: one HA device with occupancy, distance, temperature, humidity, illuminance
// and Wi-Fi signal. Topics, <base> = "whisli-sense/<id>" unless set:
//   <base>/status  online / offline (retained, last will)
//   <base>/state   {"occupancy":"ON","distance":1.23,"temperature":21.4,"humidity":45,"lux":120,"rssi":-60}
// esp-mqtt connects and reconnects in its own task, so a bad broker is only an error in the panel.
#include <ArduinoJson.h>

namespace mqtt {

struct Settings {
  bool enabled = false;
  String host;
  uint16_t port = 1883;
  String user, password;
  String baseTopic;  // empty = default
  bool discovery = true;
  String discoveryPrefix = "homeassistant";
};

void begin();
void loop();  // loop(), without StateLock

// With StateLock held:
Settings settings();
void save(const Settings &settings);  // NVS now, the client restarts in loop()
String defaultBaseTopic();
bool validTopic(const String &topic);
const char *state();  // "disabled", "connecting", "connected", "error"
String error();       // message from the broker connection, if any
void diagnostics(JsonObject out);  // state, broker, messages sent, connections since start

}  // namespace mqtt
