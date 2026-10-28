#include "radar.h"

#include <Arduino.h>

#include "board.h"
#include "eventlog.h"

namespace radar {

// Read from a new radar before anything was changed
const uint32_t FACTORY_TRIGGER[GATES] = {60000, 30000, 3000, 2000, 500, 400, 400, 300,
                                         300,   300,   300,  250,  250, 200, 200, 200};
const uint32_t FACTORY_HOLD[GATES] = {40000, 20000, 400, 300, 300, 200, 200, 150,
                                      150,   100,   100, 100, 100, 100, 100, 100};

Change::Change() {
  for (uint8_t g = 0; g < GATES; g++) trigger[g] = hold[g] = -1;
}

void Change::thresholds(const uint32_t *newTrigger, const uint32_t *newHold) {
  for (uint8_t g = 0; g < GATES; g++) {
    trigger[g] = newTrigger[g];
    hold[g] = newHold[g];
  }
}

void Change::presence(uint8_t gate, uint32_t threshold) {
  hold[gate] = threshold;
  trigger[gate] = min<uint32_t>(threshold * TRIGGER_PER_HOLD, MAX_THRESHOLD);
}

namespace {

// Command: FD FC FB FA | length (2, LE) | command (2, LE) | payload | 04 03 02 01
// ACK:     same frame, command | 0x0100, then status (2, 0 = OK) and data
// Report:  F4 F3 F2 F1 | length | presence (1) | distance cm (2) | 16 × energy (2) | F8 F7 F6 F5
constexpr uint16_t CMD_READ_FIRMWARE = 0x0000;
constexpr uint16_t CMD_WRITE = 0x0007;
constexpr uint16_t CMD_READ = 0x0008;
constexpr uint16_t CMD_SET_MODE = 0x0012;
constexpr uint16_t CMD_CONFIG_OFF = 0x00FE;
constexpr uint16_t CMD_CONFIG_ON = 0x00FF;
constexpr uint16_t REG_MIN_GATE = 0x0000, REG_MAX_GATE = 0x0001, REG_DELAY = 0x0004;
constexpr uint16_t REG_TRIGGER = 0x0010, REG_HOLD = 0x0020;  // + gate
constexpr uint32_t REPORT_MODE = 0x04;

constexpr uint32_t ACK_TIMEOUT_MS = 1000;
constexpr uint8_t TRIES = 3;
constexpr uint32_t FRAMES_TIMEOUT_MS = 5000;  // no frames this long = radar not working
constexpr uint32_t RESTART_EVERY_MS = 10000;  // then the start sequence is repeated

const uint8_t ACK_HEADER[] = {0xFD, 0xFC, 0xFB, 0xFA}, ACK_TAIL[] = {0x04, 0x03, 0x02, 0x01};
const uint8_t REPORT_TAIL[] = {0xF8, 0xF7, 0xF6, 0xF5};

HardwareSerial uart(1);

// --- Command sequences: each step waits for its ACK before the next one is sent ---

struct Step {
  uint16_t command = 0;
  uint8_t payload[18] = {};
  uint8_t length = 0;
  int8_t gate = -1;  // which gate's thresholds a CMD_READ asks for; -1 = basic settings

  void put16(uint16_t v) {
    payload[length++] = v & 0xFF;
    payload[length++] = v >> 8;
  }
  void put32(uint32_t v) {
    for (int i = 0; i < 4; i++) payload[length++] = v >> (8 * i);
  }
  void write(uint16_t reg, int32_t value) {  // skipped when value < 0 (unchanged)
    if (value < 0) return;
    put16(reg);
    put32(value);
  }
};

Step steps[40];
uint8_t stepCount = 0, stepIndex = 0;  // stepIndex < stepCount = a sequence is running
uint8_t tries = 0;
uint32_t sentAt = 0;
bool sequenceFailed = false;
uint32_t startedAt = 0;  // last start sequence

// --- State ---

int presenceValue = -1, distanceValue = -1;
uint16_t peakNow[GATES] = {};  // maximum in the current second
uint16_t peakLast[GATES] = {};  // maximum of the last full second, shown in the panel
uint32_t peakAt = 0;
Settings stored;  // as read back from the radar
bool loaded = false;
Change pending;
bool hasPending = false;
const char *error = "";
char firmware[24] = "";
void (*frameCallback)(const uint16_t *) = nullptr;

struct {
  uint32_t bytes = 0, frames = 0, acks = 0, badFrames = 0;
  uint32_t presenceChanges = 0, framesPerSecond = 0, framesAtSecond = 0;
  uint32_t lastFrameAt = 0;
} stats;

Step &add(uint16_t command) {
  Step &s = steps[stepCount++];
  s = Step();
  s.command = command;
  return s;
}

void send(const Step &s) {
  uint8_t frame[sizeof(ACK_HEADER) + 4 + sizeof(s.payload) + sizeof(ACK_TAIL)];
  size_t n = 0;
  memcpy(frame, ACK_HEADER, 4);
  n += 4;
  frame[n++] = (2 + s.length) & 0xFF;
  frame[n++] = 0;
  frame[n++] = s.command & 0xFF;
  frame[n++] = s.command >> 8;
  memcpy(frame + n, s.payload, s.length);
  n += s.length;
  memcpy(frame + n, ACK_TAIL, 4);
  n += 4;
  uart.write(frame, n);
  sentAt = millis();
}

void run() {
  stepIndex = 0;
  tries = 1;
  sequenceFailed = false;
  error = "";
  send(steps[0]);
}

bool running() { return stepIndex < stepCount; }

// Config mode on, [writes], read everything back, config mode off
void beginConfig() {
  add(CMD_CONFIG_ON).put16(0x0002);
}

void endConfig() {
  Step &basic = add(CMD_READ);
  basic.put16(REG_MIN_GATE);
  basic.put16(REG_MAX_GATE);
  basic.put16(REG_DELAY);
  for (uint8_t g = 0; g < GATES; g++) {
    Step &s = add(CMD_READ);
    s.gate = g;
    s.put16(REG_TRIGGER + g);
    s.put16(REG_HOLD + g);
  }
  add(CMD_CONFIG_OFF);
}

// Firmware version (proves both UART directions work), report mode, then read the settings
void startSequence() {
  stepCount = 0;
  add(CMD_READ_FIRMWARE);
  Step &mode = add(CMD_SET_MODE);
  mode.put16(0);
  mode.put32(REPORT_MODE);
  beginConfig();
  endConfig();
  startedAt = millis();
  run();
}

void writeSequence(const Change &c) {
  stepCount = 0;
  beginConfig();
  if (c.minGate >= 0 || c.maxGate >= 0 || c.delay >= 0) {
    Step &s = add(CMD_WRITE);
    s.write(REG_MIN_GATE, c.minGate);
    s.write(REG_MAX_GATE, c.maxGate);
    s.write(REG_DELAY, c.delay);
  }
  for (uint8_t g = 0; g < GATES; g++) {
    if (c.trigger[g] < 0 && c.hold[g] < 0) continue;
    Step &s = add(CMD_WRITE);
    s.write(REG_TRIGGER + g, c.trigger[g]);
    s.write(REG_HOLD + g, c.hold[g]);
  }
  endConfig();
  run();
}

void nextStep() {
  if (++stepIndex < stepCount) {
    tries = 1;
    send(steps[stepIndex]);
  } else if (!sequenceFailed) {
    if (loaded) eventlog::info("radar", "radarSaved");  // a write; the first read at start is not news
    loaded = true;
  }
}

// --- Parsing ---

uint32_t u32(const uint8_t *p) { return p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24; }

enum class Parse : uint8_t { idle, length, data, tail };
Parse parse = Parse::idle;
bool isAck = false;
uint8_t frame[64];
uint16_t frameLength = 0, position = 0;
uint32_t window = 0;  // last 4 bytes, to spot a header

void handleAck() {
  if (frameLength < 4) return void(stats.badFrames++);
  stats.acks++;
  const uint16_t command = frame[0] | frame[1] << 8;
  const uint16_t status = frame[2] | frame[3] << 8;
  if (!running() || command != (steps[stepIndex].command | 0x0100)) return;
  const Step &s = steps[stepIndex];
  if (status != 0) {
    if (s.command != CMD_CONFIG_OFF) {
      sequenceFailed = true;
      error = "rejected";
    }
  } else if (s.command == CMD_READ_FIRMWARE && frameLength >= 6) {
    size_t n = min<size_t>(frame[4] | frame[5] << 8, min<size_t>(frameLength - 6, sizeof(firmware) - 1));
    memcpy(firmware, frame + 6, n);
    firmware[n] = '\0';
  } else if (s.command == CMD_READ && s.gate < 0 && frameLength >= 16) {
    stored.minGate = u32(frame + 4);
    stored.maxGate = u32(frame + 8);
    stored.delay = u32(frame + 12);
  } else if (s.command == CMD_READ && frameLength >= 12) {
    stored.trigger[s.gate] = u32(frame + 4);
    stored.hold[s.gate] = u32(frame + 8);
  }
  nextStep();
}

void handleReport() {
  if (frameLength < 3) return void(stats.badFrames++);
  stats.frames++;
  stats.lastFrameAt = millis();
  const int presence = frame[0] ? 1 : 0;
  if (presenceValue >= 0 && presence != presenceValue) stats.presenceChanges++;
  presenceValue = presence;
  distanceValue = frame[1] | frame[2] << 8;
  if (frameLength < 3 + 2 * GATES) return;
  uint16_t energy[GATES];
  for (uint8_t g = 0; g < GATES; g++) {
    energy[g] = frame[3 + 2 * g] | frame[4 + 2 * g] << 8;
    peakNow[g] = max(peakNow[g], energy[g]);
  }
  if (frameCallback) frameCallback(energy);
}

void feed(uint8_t b) {
  stats.bytes++;
  switch (parse) {
    case Parse::length:
      frameLength |= b << (8 * position);
      if (++position < 2) return;
      position = 0;
      if (frameLength > sizeof(frame)) {
        stats.badFrames++;
        parse = Parse::idle;
      } else {
        parse = frameLength ? Parse::data : Parse::tail;
      }
      return;
    case Parse::data:
      frame[position++] = b;
      if (position == frameLength) {
        position = 0;
        parse = Parse::tail;
      }
      return;
    case Parse::tail:
      if (b != (isAck ? ACK_TAIL : REPORT_TAIL)[position]) {
        stats.badFrames++;
        parse = Parse::idle;
      } else if (++position == 4) {
        parse = Parse::idle;
        isAck ? handleAck() : handleReport();
      }
      return;
    case Parse::idle:
      break;
  }
  // Anything between frames (e.g. text lines before report mode is on) is skipped.
  window = window << 8 | b;
  if (window == 0xFDFCFBFA || window == 0xF4F3F2F1) {
    isAck = window == 0xFDFCFBFA;
    parse = Parse::length;
    frameLength = position = 0;
    window = 0;
  }
}

}  // namespace

void begin() {
  uart.setRxBufferSize(1024);
  uart.begin(115200, SERIAL_8N1, pins::RADAR_RX, pins::RADAR_TX);
  pinMode(pins::RADAR_OUT, INPUT);
}

void loop() {
  while (uart.available()) feed(uart.read());
  const uint32_t now = millis();

  if (now - peakAt >= 1000) {
    peakAt = now;
    memcpy(peakLast, peakNow, sizeof(peakLast));
    stats.framesPerSecond = stats.frames - stats.framesAtSecond;
    stats.framesAtSecond = stats.frames;
    static bool wasWorking = false;  // log when the radar starts or stops sending
    if (working() != wasWorking) {
      wasWorking = working();
      wasWorking ? eventlog::info("radar", "radarOk", firmware) : eventlog::warning("radar", "radarLost");
    }
    memset(peakNow, 0, sizeof(peakNow));
  }

  if (running()) {
    if (now - sentAt < ACK_TIMEOUT_MS) return;
    if (tries++ < TRIES) return send(steps[stepIndex]);
    error = "noReply";
    eventlog::error("radar", "radarFailed", error);
    stepCount = stepIndex = 0;
    return;
  }
  if (hasPending && working()) {
    writeSequence(pending);
    pending = Change();
    hasPending = false;
    return;
  }
  // At boot, and again whenever the radar stops sending (e.g. it was power cycled)
  if ((!loaded || !working()) && (!startedAt || now - startedAt >= RESTART_EVERY_MS)) startSequence();
}

int presence() { return working() ? presenceValue : -1; }
int distanceCm() { return working() && presenceValue == 1 ? distanceValue : -1; }
const uint16_t *energy() { return peakLast; }
bool working() { return stats.frames && millis() - stats.lastFrameAt < FRAMES_TIMEOUT_MS; }
bool settingsLoaded() { return loaded; }
bool busy() { return running() || hasPending; }
const Settings &settings() { return stored; }
void onFrame(void (*callback)(const uint16_t *)) { frameCallback = callback; }

void apply(const Change &c) {
  if (c.minGate >= 0) pending.minGate = c.minGate;
  if (c.maxGate >= 0) pending.maxGate = c.maxGate;
  if (c.delay >= 0) pending.delay = c.delay;
  for (uint8_t g = 0; g < GATES; g++) {
    if (c.trigger[g] >= 0) pending.trigger[g] = c.trigger[g];
    if (c.hold[g] >= 0) pending.hold[g] = c.hold[g];
  }
  hasPending = true;
}

const char *problem() {
  if (!stats.bytes) return "radarSilent";  // nothing on the UART: wiring or power
  if (!working()) return "radarNoFrames";
  if (*error) return "radarSettings";
  return nullptr;
}

void diagnostics(JsonObject out) {
  out["working"] = working();
  out["firmware"] = firmware;
  out["bytes"] = stats.bytes;
  out["frames"] = stats.frames;
  out["acks"] = stats.acks;
  out["badFrames"] = stats.badFrames;
  if (stats.frames) out["lastFrameMs"] = millis() - stats.lastFrameAt;
  out["outPin"] = digitalRead(pins::RADAR_OUT);
  out["settingsLoaded"] = loaded;
  out["error"] = error;
  out["framesPerSecond"] = stats.framesPerSecond;
  out["presenceChanges"] = stats.presenceChanges;
}

}  // namespace radar
