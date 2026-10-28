#pragma once
// Event log in RAM: the last events (start, Wi-Fi, MQTT, radar, sensors, calibration, sign-in,
// updates) for System → Event log. Lost on restart. Safe to call from any task.
// Each entry has a code the panel translates (log.<code>) and a short detail ({detail}).
#include <ArduinoJson.h>

namespace eventlog {

enum class Level : uint8_t { info, warning, error };

void add(Level level, const char *category, const char *code, const char *detail = "");
void info(const char *category, const char *code, const char *detail = "");
void warning(const char *category, const char *code, const char *detail = "");
void error(const char *category, const char *code, const char *detail = "");

// Newest last. after/before: entry ids (0 = none); level/category: "" = all.
void toJson(JsonObject out, uint32_t after, uint32_t before, uint16_t limit, const char *level, const char *category);

}  // namespace eventlog
