#pragma once
// Device identity: the user-given name (NVS), the hostname made from it and the MAC-based id.
#include <Arduino.h>

namespace device {

constexpr size_t MAX_NAME_LENGTH = 32;  // bytes of UTF-8

void begin();
String id();        // last 2 MAC bytes, e.g. "90e8"; stable, used in MQTT topics and the AP name

// With StateLock held:
String name();      // "Salon"; default "Whisli Sense 90E8"
String hostname();  // "whisli-salon" -> http://whisli-salon.local/
bool setName(const String &name);  // false if empty or too long; saves to NVS
uint32_t nameVersion();  // changes on every rename, so network/MQTT can re-announce

}  // namespace device
