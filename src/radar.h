#pragma once
// Waveshare HMMD mmWave radar (S3KM1110 chip, protocol as HLK-LD2420), UART 115200 8N1.
//
// The radar runs in report mode: ~10 frames a second with presence, distance and the energy in
// each of 16 gates (70 cm each). Each gate has two thresholds stored in the radar: presence starts
// when the energy rises above "trigger" and lasts while it stays above "hold" (plus the delay).
#include <ArduinoJson.h>

namespace radar {

constexpr uint8_t GATES = 16;
constexpr uint16_t GATE_CM = 70;
constexpr uint16_t MAX_DELAY_S = 600;
constexpr uint32_t MAX_THRESHOLD = 65535;
// The panel shows one "presence threshold" per gate: hold. Trigger is kept this much higher, so
// movement starts presence easily and breathing above the line keeps it.
constexpr float TRIGGER_PER_HOLD = 1.5f;

struct Settings {
  uint8_t minGate = 0, maxGate = 0;  // targets outside these gates are ignored
  uint16_t delay = 0;                // seconds presence lasts after the last detection
  uint32_t trigger[GATES] = {};
  uint32_t hold[GATES] = {};
};

// Values to write; -1 = leave as is
struct Change {
  int32_t minGate = -1, maxGate = -1, delay = -1;
  int32_t trigger[GATES], hold[GATES];
  Change();
  void thresholds(const uint32_t *trigger, const uint32_t *hold);  // all gates
  void presence(uint8_t gate, uint32_t threshold);  // hold = threshold, trigger = threshold × TRIGGER_PER_HOLD
};

extern const uint32_t FACTORY_TRIGGER[GATES];
extern const uint32_t FACTORY_HOLD[GATES];

void begin();
// loop(), with StateLock held: reads the UART and runs command sequences
void loop();

// With StateLock held:
int presence();    // 1 / 0, -1 = unknown
int distanceCm();  // -1 = unknown
const uint16_t *energy();  // per gate, maximum over the last second
bool working();            // frames arrive
bool settingsLoaded();
bool busy();               // reading or writing settings
const Settings &settings();
void apply(const Change &change);  // queued, written by loop()
void onFrame(void (*callback)(const uint16_t *energy));  // every report frame (calibration)
const char *problem();     // nullptr or a code for the panel
void diagnostics(JsonObject out);

}  // namespace radar
