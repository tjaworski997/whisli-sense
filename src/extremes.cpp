#include "extremes.h"

#include <Preferences.h>
#include <time.h>

#include <algorithm>

#include "climate.h"
#include "lock.h"

namespace extremes {
namespace {

constexpr const char *NVS = "sense-extremes";
constexpr uint8_t HOURS = 24, DAYS = 30;
constexpr uint32_t HOUR_MS = 3600UL * 1000;
constexpr uint32_t SAVE_EVERY_MS = 10UL * 60 * 1000;  // a restart loses at most this much
constexpr time_t CLOCK_SET_AFTER = 1700000000;        // until SNTP answers, time() counts from 1970

// Tenths of °C and %, whole lux (BH1750 tops out at 54612 lx)
struct Range {
  int16_t tMin, tMax, hMin, hMax;
  uint16_t lMin, lMax;
};
constexpr Range EMPTY = {INT16_MAX, INT16_MIN, INT16_MAX, INT16_MIN, UINT16_MAX, 0};

// Saved to NVS as one blob; a changed layout has a different size and starts empty.
struct Stored {
  uint32_t hour = 0;       // hours since 1970 of hours[0]; 0 = the clock was never set
  uint8_t hoursInDay = 0;  // hours already closed into days[0]
  Range hours[HOURS];      // [0] = the current hour
  Range days[DAYS];        // [0] = the current day: 24 h of running time, not a calendar day
};

// Shared (StateLock)
Stored data;

// loop() only
uint32_t hourStartedAt = 0, savedAt = 0;

void widenClimate(Range &r, int16_t t, int16_t h) {
  r.tMin = std::min(r.tMin, t);
  r.tMax = std::max(r.tMax, t);
  r.hMin = std::min(r.hMin, h);
  r.hMax = std::max(r.hMax, h);
}

void widenLight(Range &r, uint16_t lux) {
  r.lMin = std::min(r.lMin, lux);
  r.lMax = std::max(r.lMax, lux);
}

void nextHour() {
  std::copy_backward(data.hours, data.hours + HOURS - 1, data.hours + HOURS);
  data.hours[0] = EMPTY;
  if (++data.hoursInDay < 24) return;
  data.hoursInDay = 0;
  std::copy_backward(data.days, data.days + DAYS - 1, data.days + DAYS);
  data.days[0] = EMPTY;
}

// With a clock, the hours follow it - also those the sensor was switched off. Without one (no
// internet), they follow the running time and an outage simply does not count.
void advance() {
  const time_t now = time(nullptr);
  if (now > CLOCK_SET_AFTER) {
    const uint32_t hour = now / 3600;
    if (data.hour && hour > data.hour) {
      const uint32_t passed = std::min<uint32_t>(hour - data.hour, (DAYS + 1) * 24);  // then all empty
      for (uint32_t i = 0; i < passed; i++) nextHour();
    }
    data.hour = hour;
  } else if (millis() - hourStartedAt >= HOUR_MS) {
    hourStartedAt += HOUR_MS;
    nextHour();
    if (data.hour) data.hour++;  // keeps the count right for when the clock comes back
  }
}

void store() {
  Stored copy;
  {
    StateLock lock;
    copy = data;
  }
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putBytes("data", &copy, sizeof(copy));
  prefs.end();
}

void merge(JsonObject out, const Range *ranges, size_t count) {
  Range r = EMPTY;
  for (size_t i = 0; i < count; i++) {
    // Field by field: an empty range holds its sentinels, which must not leak into the other side
    r.tMin = std::min(r.tMin, ranges[i].tMin);
    r.tMax = std::max(r.tMax, ranges[i].tMax);
    r.hMin = std::min(r.hMin, ranges[i].hMin);
    r.hMax = std::max(r.hMax, ranges[i].hMax);
    r.lMin = std::min(r.lMin, ranges[i].lMin);
    r.lMax = std::max(r.lMax, ranges[i].lMax);
  }
  const bool noClimate = r.tMin == INT16_MAX, noLight = r.lMin == UINT16_MAX;
  auto put = [&](const char *key, bool empty, int32_t value, float scale, unsigned digits) {
    if (empty) out[key] = nullptr;
    else out[key] = serialized(String(value / scale, digits));
  };
  put("temperatureMin", noClimate, r.tMin, 10, 1);
  put("temperatureMax", noClimate, r.tMax, 10, 1);
  put("humidityMin", noClimate, r.hMin, 10, 0);
  put("humidityMax", noClimate, r.hMax, 10, 0);
  put("luxMin", noLight, r.lMin, 1, 0);
  put("luxMax", noLight, r.lMax, 1, 0);
}

}  // namespace

void begin() {
  std::fill(data.hours, data.hours + HOURS, EMPTY);
  std::fill(data.days, data.days + DAYS, EMPTY);
  Preferences prefs;
  prefs.begin(NVS, true);
  if (prefs.getBytesLength("data") == sizeof(data)) prefs.getBytes("data", &data, sizeof(data));
  prefs.end();
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // UTC; only whole hours matter here
  hourStartedAt = savedAt = millis();
}

void tick() {
  {
    StateLock lock;
    advance();
    const climate::Reading r = climate::reading();
    if (r.climateValid) {
      const int16_t t = lroundf(r.temperature * 10), h = lroundf(r.humidity * 10);
      widenClimate(data.hours[0], t, h);
      widenClimate(data.days[0], t, h);
    }
    if (r.lightValid) {
      const uint16_t lux = std::min(lroundf(r.lux), 65534L);  // 65535 marks an empty range
      widenLight(data.hours[0], lux);
      widenLight(data.days[0], lux);
    }
  }
  if (millis() - savedAt >= SAVE_EVERY_MS) {
    savedAt = millis();
    store();
  }
}

void save() { store(); }

void describe(JsonObject out) {
  merge(out["day"].to<JsonObject>(), data.hours, HOURS);
  merge(out["week"].to<JsonObject>(), data.days, 7);
  merge(out["month"].to<JsonObject>(), data.days, DAYS);
}

}  // namespace extremes
