#pragma once
// Lowest and highest temperature, humidity and light over the last 24 h, 7 and 30 days, kept in NVS.
#include <ArduinoJson.h>

namespace extremes {

void begin();  // after net::begin(): starts SNTP, which tells how long the sensor was off
void tick();   // loop(), once a second, after climate::tick()
void save();   // writes to NVS (also every 10 min by itself); call it before a planned restart

// With StateLock held:
void describe(JsonObject out);  // {"day": {"temperatureMin": 21.3, ...}, "week": ..., "month": ...}

}  // namespace extremes
