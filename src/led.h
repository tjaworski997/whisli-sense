#pragma once
// On-board RGB LED. What it shows is set in the panel (System → Settings) and saved in NVS:
//   distance  - blinks while someone is there, faster the closer they are (like a parking sensor)
//   presence  - lit while someone is there
//   status    - dark while all is well (default)
//   off       - never lit
// With "alerts" on, problems take priority: blue blink = no Wi-Fi, red blink = a sensor problem.
// "darkOff" keeps it dark when the room is dark. BOOT held (password reset) always flashes white.
#include <ArduinoJson.h>

namespace led {

enum class Mode : uint8_t { off, status, presence, distance };
constexpr uint8_t COLORS = 5;  // blue, green, white, purple, amber

struct Settings {
  Mode mode = Mode::status;
  uint8_t color = 0;        // index into the palette
  uint8_t brightness = 10;  // %, 1-100; the WS2812 is very bright
  bool alerts = true;
  bool darkOff = false;
};

// What the LED can show right now
struct Inputs {
  bool resetting = false, offline = false, problem = false;
  int presence = -1, distanceCm = -1;
  bool dark = false;
};

void begin();  // loads the settings, then a short red-green-blue test
void show(const Inputs &now);  // loop()

// With StateLock held:
Settings settings();
void save(const Settings &settings);
void toJson(const Settings &settings, JsonObject out);
bool fromJson(const char *mode, const char *color, Settings &out);  // false if a name is unknown

}  // namespace led
