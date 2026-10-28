#pragma once
// Wi-Fi client, the setup access point and mDNS.
//
// Without saved Wi-Fi, or after 60 s without a connection, the sensor opens the access point
// "Whisli-Sense-XXXX" (192.168.4.1). It closes again once Wi-Fi is up and nobody uses it.
#include <ArduinoJson.h>

namespace net {

void begin();
void loop();  // loop(), without StateLock: talks to the Wi-Fi driver

// With StateLock held:
bool connected();
void status(JsonObject out);
void connect(const String &ssid, const String &password);  // saved and applied by loop()
void forget();
void setApPassword(const String &password);
void startScan();
void scanResults(JsonObject out);
void diagnostics(JsonObject out);  // SSID, BSSID, channel, addresses, disconnects since start

}  // namespace net
