#include "led.h"

#include <Arduino.h>
#include <Preferences.h>

#include "board.h"

namespace led {
namespace {

const char *const MODE_NAMES[] = {"off", "status", "presence", "distance"};
const char *const COLOR_NAMES[COLORS] = {"blue", "green", "white", "purple", "amber"};
const uint8_t PALETTE[COLORS][3] = {{0, 80, 255}, {0, 255, 40}, {255, 255, 255}, {170, 0, 255}, {255, 120, 0}};
constexpr const char *NVS = "sense-led";

// Distance blinking: period from 150 ms (40 cm and closer) to 1.5 s (6 m and farther)
constexpr int NEAR_CM = 40, FAR_CM = 600;
constexpr uint32_t FASTEST_MS = 150, SLOWEST_MS = 1500, BLINK_ON_MS = 70;

Settings current;  // shared (StateLock); show() copies these few bytes without it
uint32_t lastColor = 0xFFFFFFFF;

void write(uint8_t r, uint8_t g, uint8_t b, uint8_t percent) {
  const uint32_t color = r << 16 | g << 8 | b;
  const uint32_t key = color ^ percent << 24;
  if (key == lastColor) return;  // write the LED only when it changes
  lastColor = key;
  const uint16_t scale = percent * 255 / 100;
  rgbLedWrite(pins::LED, r * scale / 255, g * scale / 255, b * scale / 255);
}

void off() { write(0, 0, 0, 0); }

uint32_t blinkPeriod(int cm) {
  const float share = constrain((cm - NEAR_CM) / float(FAR_CM - NEAR_CM), 0.0f, 1.0f);
  return FASTEST_MS + share * (SLOWEST_MS - FASTEST_MS);
}

}  // namespace

void begin() {
  Preferences prefs;
  prefs.begin(NVS, true);
  current.mode = (Mode)min<uint8_t>(prefs.getUChar("mode", (uint8_t)current.mode), (uint8_t)Mode::distance);
  current.color = min<uint8_t>(prefs.getUChar("color", current.color), COLORS - 1);
  current.brightness = constrain(prefs.getUChar("bright", current.brightness), 1, 100);
  current.alerts = prefs.getBool("alerts", current.alerts);
  current.darkOff = prefs.getBool("darkOff", current.darkOff);
  prefs.end();

  for (auto c : {0xFF0000, 0x00FF00, 0x0000FF}) {  // the board runs and the colours are right
    write(c >> 16, c >> 8 & 0xFF, c & 0xFF, 10);
    delay(250);
  }
  off();
}

void show(const Inputs &now) {
  const Settings s = current;  // a torn read would only last one frame
  const uint32_t t = millis();
  if (now.resetting) return t % 200 < 100 ? write(255, 255, 255, 30) : off();
  if (s.alerts && now.offline) return t % 2000 < 150 ? write(0, 0, 255, s.brightness) : off();
  if (s.alerts && now.problem) return t % 3000 < 150 ? write(255, 0, 0, s.brightness) : off();
  if ((s.darkOff && now.dark) || now.presence != 1) return off();

  const uint8_t *c = PALETTE[s.color];
  if (s.mode == Mode::presence) return write(c[0], c[1], c[2], s.brightness);
  if (s.mode == Mode::distance && now.distanceCm >= 0) {
    return t % blinkPeriod(now.distanceCm) < BLINK_ON_MS ? write(c[0], c[1], c[2], s.brightness) : off();
  }
  off();
}

Settings settings() { return current; }

void save(const Settings &s) {
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putUChar("mode", (uint8_t)s.mode);
  prefs.putUChar("color", s.color);
  prefs.putUChar("bright", s.brightness);
  prefs.putBool("alerts", s.alerts);
  prefs.putBool("darkOff", s.darkOff);
  prefs.end();
  current = s;
}

void toJson(const Settings &s, JsonObject out) {
  out["mode"] = MODE_NAMES[(int)s.mode];
  out["color"] = COLOR_NAMES[s.color];
  out["brightness"] = s.brightness;
  out["alerts"] = s.alerts;
  out["darkOff"] = s.darkOff;
}

bool fromJson(const char *mode, const char *color, Settings &out) {
  if (mode) {
    int i = 0;
    while (i < 4 && strcmp(mode, MODE_NAMES[i])) i++;
    if (i == 4) return false;
    out.mode = (Mode)i;
  }
  if (color) {
    int i = 0;
    while (i < COLORS && strcmp(color, COLOR_NAMES[i])) i++;
    if (i == COLORS) return false;
    out.color = i;
  }
  return true;
}

}  // namespace led
