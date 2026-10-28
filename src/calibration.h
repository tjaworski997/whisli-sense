#pragma once
// Threshold calibration wizard. The sensor times the steps itself; the panel only guides the user:
//   leave  - the user walks out
//   empty  - measures the empty room's noise (max energy per gate), then writes thresholds from it
//   back   - the user comes back and sits down where they usually sit
//   still  - measures the sitting person's breathing, lowers "hold" in gates where it shows
//   done   - thresholds written; undo() restores the previous ones
// All functions expect StateLock held.
#include <ArduinoJson.h>

namespace calibration {

struct Options {
  uint16_t leaveS = 10, emptyS = 40, backS = 20, stillS = 20;
  uint16_t marginPct = 50;  // headroom above noise
};

bool start(const Options &options);  // false while the radar settings are not known yet
void seated();                       // "I'm sitting already" - skip the rest of the "back" countdown
void cancel();
bool undo();
bool active();

void sample(const uint16_t *energy);  // every radar frame
void loop();
void status(JsonObject out);

}  // namespace calibration
