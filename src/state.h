#pragma once
// The sensor's live state as JSON. All functions expect StateLock held.
#include <ArduinoJson.h>

namespace state {

// Everything the panel shows live: readings, radar settings and energy, calibration, problems.
// Sent over ws://<ip>/api/v1/ws every second and at once when presence changes; GET /api/v1/state.
void full(JsonObject out);
// A short summary for the sensors overview (ws://<ip>/api/v1/live, no sign-in needed).
void summary(JsonObject out);
// Problem codes (translated by the panel): "sht30", "bh1750", "radarSilent", "radarNoFrames", ...
void problems(JsonArray out);
size_t problemCount();

// Why the chip last started: "powerOn", "software", "panic", "watchdog", "brownout", "usb", "other"
const char *resetReason();
// loop() reports how long each pass took; diagnostics shows the average and the longest
void recordLoop(uint32_t micros);
// Chip, memory, flash and loop timing for System → Diagnostics
void system(JsonObject out);

}  // namespace state
