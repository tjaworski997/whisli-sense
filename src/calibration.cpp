#include "calibration.h"

#include <Arduino.h>

#include <algorithm>

#include "eventlog.h"
#include "radar.h"

namespace calibration {
namespace {

using radar::GATES;

enum class Phase : uint8_t { idle, leave, empty, back, still, done, failed };
const char *const PHASE_NAMES[] = {"idle", "leave", "empty", "back", "still", "done", "failed"};

constexpr uint8_t STILL_MAX_S = 60;
constexpr uint32_t MIN_HOLD = 60, MIN_TRIGGER = 100;

Phase phase = Phase::idle;
uint32_t phaseAt = 0;
Options options;
uint32_t emptyFrames = 0;
uint16_t noise[GATES] = {};                   // max energy in the empty room
uint16_t secondPeak[GATES] = {};              // max in the current second while the person sits
uint32_t secondAt = 0;
uint8_t stillSeconds = 0;
uint16_t stillPeaks[GATES][STILL_MAX_S] = {};
uint16_t person[GATES] = {};                  // 20th percentile of the per-second peaks
uint16_t personMask = 0;                      // gates where breathing stands out from noise
bool hasPrevious = false;
uint32_t previousTrigger[GATES] = {}, previousHold[GATES] = {};
const char *error = "";

void enter(Phase next) {
  phase = next;
  phaseAt = millis();
}

uint16_t phaseSeconds() {
  switch (phase) {
    case Phase::leave: return options.leaveS;
    case Phase::empty: return options.emptyS;
    case Phase::back: return options.backS;
    case Phase::still: return options.stillS;
    default: return 0;
  }
}

uint32_t secondsLeft() {
  const uint32_t elapsed = (millis() - phaseAt) / 1000;
  return phaseSeconds() > elapsed ? phaseSeconds() - elapsed : 0;
}

uint32_t clampThreshold(float value, uint32_t minimum) {
  return std::min<uint32_t>(std::max<uint32_t>(value, minimum), radar::MAX_THRESHOLD);
}

// Without the person: hold = noise × (1 + margin), trigger = hold × (1 + margin).
// With the person, in gates where breathing (20th percentile) is at least 1.3 × noise: hold sits
// between noise and breathing, closer to noise (40% of the way on a log scale, at least
// noise × 1.15), trigger = hold × 1.5.
void writeThresholds(bool withPerson) {
  uint32_t trigger[GATES], hold[GATES];
  const float margin = 1 + options.marginPct / 100.0f;
  personMask = 0;
  for (uint8_t g = 0; g < GATES; g++) {
    const float n = std::max<float>(noise[g], 1);
    float h = n * margin, t = h * margin;
    if (withPerson) {
      uint16_t sorted[STILL_MAX_S];
      std::copy(stillPeaks[g], stillPeaks[g] + stillSeconds, sorted);
      std::sort(sorted, sorted + stillSeconds);
      person[g] = sorted[stillSeconds / 5];
      if (person[g] >= n * 1.3f) {
        personMask |= 1 << g;
        h = std::max(n * powf(person[g] / n, 0.4f), n * 1.15f);
        t = h * 1.5f;
      }
    }
    hold[g] = clampThreshold(h, MIN_HOLD);
    trigger[g] = clampThreshold(t, MIN_TRIGGER);
  }
  radar::Change change;
  change.thresholds(trigger, hold);
  radar::apply(change);
}

void fail(const char *code) {
  eventlog::warning("radar", "calibrationFailed", code);
  error = code;
  enter(Phase::failed);
}

}  // namespace

bool start(const Options &o) {
  if (!radar::settingsLoaded()) return false;
  options = o;
  memcpy(previousTrigger, radar::settings().trigger, sizeof(previousTrigger));
  memcpy(previousHold, radar::settings().hold, sizeof(previousHold));
  hasPrevious = true;
  memset(noise, 0, sizeof(noise));
  memset(person, 0, sizeof(person));
  personMask = 0;
  emptyFrames = stillSeconds = 0;
  error = "";
  enter(Phase::leave);
  eventlog::info("radar", "calibrationStarted");
  return true;
}

void seated() {
  if (phase == Phase::back) phaseAt = millis() - options.backS * 1000UL;
}

void cancel() {
  if (!active()) return;
  // After the empty room step the noise thresholds stay written; undo() restores the old ones.
  fail(phase == Phase::back || phase == Phase::still ? "cancelledAfterNoise" : "cancelled");
}

bool undo() {
  if (!hasPrevious || active()) return false;
  radar::Change change;
  change.thresholds(previousTrigger, previousHold);
  radar::apply(change);
  hasPrevious = false;
  eventlog::info("radar", "calibrationUndone");
  enter(Phase::idle);
  return true;
}

bool active() { return phase >= Phase::leave && phase <= Phase::still; }

void sample(const uint16_t *energy) {
  if (phase == Phase::empty) {
    emptyFrames++;
    for (uint8_t g = 0; g < GATES; g++) noise[g] = std::max(noise[g], energy[g]);
  } else if (phase == Phase::still) {
    for (uint8_t g = 0; g < GATES; g++) secondPeak[g] = std::max(secondPeak[g], energy[g]);
    if (millis() - secondAt < 1000) return;
    secondAt += 1000;
    if (stillSeconds < STILL_MAX_S) {
      for (uint8_t g = 0; g < GATES; g++) stillPeaks[g][stillSeconds] = secondPeak[g];
      stillSeconds++;
    }
    memset(secondPeak, 0, sizeof(secondPeak));
  }
}

void loop() {
  if (!active() || secondsLeft() > 0 || millis() - phaseAt < 1000) return;
  switch (phase) {
    case Phase::leave:
      enter(Phase::empty);
      break;
    case Phase::empty:
      if (!emptyFrames) return fail("noEnergy");
      writeThresholds(false);
      enter(Phase::back);
      break;
    case Phase::back:
      memset(secondPeak, 0, sizeof(secondPeak));
      secondAt = millis();
      stillSeconds = 0;
      enter(Phase::still);
      break;
    case Phase::still:
      if (stillSeconds < 5) return fail("tooFewSamples");
      writeThresholds(true);
      enter(Phase::done);
      eventlog::info("radar", "calibrationDone", String(__builtin_popcount(personMask)).c_str());
      break;
    default:
      break;
  }
}

void status(JsonObject out) {
  out["phase"] = PHASE_NAMES[(int)phase];
  out["left"] = secondsLeft();
  out["emptyS"] = options.emptyS;
  out["margin"] = options.marginPct;
  out["personMask"] = personMask;
  out["hasPrevious"] = hasPrevious;
  out["error"] = error;
  JsonArray n = out["noise"].to<JsonArray>(), p = out["person"].to<JsonArray>();
  JsonArray pt = out["previousTrigger"].to<JsonArray>(), ph = out["previousHold"].to<JsonArray>();
  for (uint8_t g = 0; g < GATES; g++) {
    n.add(noise[g]);
    p.add(person[g]);
    pt.add(previousTrigger[g]);
    ph.add(previousHold[g]);
  }
}

}  // namespace calibration
