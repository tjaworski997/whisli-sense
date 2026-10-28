#include "climate.h"

#include <Wire.h>

#include "board.h"
#include "eventlog.h"
#include "lock.h"

namespace climate {
namespace {

const uint8_t SHT30_ADDRESSES[] = {0x44, 0x45};   // depends on the module's ADDR pin
const uint8_t BH1750_ADDRESSES[] = {0x23, 0x5C};

struct Sensor {
  uint8_t address = 0;   // 0 = not found yet; a failed read clears it so the next tick probes again
  bool started = false;  // SHT30: measurement triggered; BH1750: continuous mode switched on
  bool valid = false;
  uint32_t reads = 0, errors = 0;
  const char *lastError = "";  // code, translated by the panel
};

// Shared (StateLock)
Sensor sht, bh;
Reading current;

uint8_t probe(const uint8_t *addresses, size_t count) {
  for (size_t i = 0; i < count; i++) {
    Wire.beginTransmission(addresses[i]);
    if (Wire.endTransmission() == 0) return addresses[i];
  }
  return 0;
}

bool command(uint8_t address, const uint8_t *bytes, size_t length) {
  Wire.beginTransmission(address);
  Wire.write(bytes, length);
  return Wire.endTransmission() == 0;
}

bool readBytes(uint8_t address, uint8_t *out, size_t length) {
  if (Wire.requestFrom(address, (uint8_t)length) != length) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (size_t i = 0; i < length; i++) out[i] = Wire.read();
  return true;
}

void fail(Sensor &s, const char *error) {
  s.errors++;
  s.valid = s.started = false;
  s.lastError = error;
  s.address = 0;
}

bool find(Sensor &s, const uint8_t *addresses, size_t count) {
  if (!s.address) s.address = probe(addresses, count);
  if (!s.address) {
    s.valid = false;
    s.lastError = "noResponse";
  }
  return s.address;
}

// Sensirion CRC-8: polynomial 0x31, init 0xFF, over two bytes
uint8_t crc8(const uint8_t *data) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < 2; i++) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; bit++) crc = crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1;
  }
  return crc;
}

// Single shot, high repeatability (0x2400). Triggered in one tick and read in the next, a second
// later, so nothing waits for the 15 ms measurement.
void tickSht30(Sensor &s, Reading &r) {
  if (!find(s, SHT30_ADDRESSES, sizeof(SHT30_ADDRESSES))) return;
  if (s.started) {
    uint8_t b[6];  // T msb, T lsb, CRC, RH msb, RH lsb, CRC
    if (!readBytes(s.address, b, sizeof(b))) return fail(s, "shortRead");
    if (crc8(b) != b[2] || crc8(b + 3) != b[5]) return fail(s, "crc");
    r.temperature = -45 + 175.0f * (b[0] << 8 | b[1]) / 65535;
    r.humidity = 100.0f * (b[3] << 8 | b[4]) / 65535;
    s.valid = true;
    s.reads++;
    s.lastError = "";
  }
  static const uint8_t MEASURE[] = {0x24, 0x00};
  if (!command(s.address, MEASURE, sizeof(MEASURE))) return fail(s, "noAck");
  s.started = true;
}

// Power on (0x01) and continuous high resolution mode (0x10); a result is ready every 180 ms.
void tickBh1750(Sensor &s, Reading &r) {
  if (!find(s, BH1750_ADDRESSES, sizeof(BH1750_ADDRESSES))) return;
  if (!s.started) {
    static const uint8_t POWER_ON = 0x01, CONTINUOUS_HIGH_RES = 0x10;
    if (!command(s.address, &POWER_ON, 1) || !command(s.address, &CONTINUOUS_HIGH_RES, 1)) return fail(s, "noAck");
    s.started = true;
    return;
  }
  uint8_t b[2];
  if (!readBytes(s.address, b, sizeof(b))) return fail(s, "shortRead");
  r.lux = (b[0] << 8 | b[1]) / 1.2f;
  s.valid = true;
  s.reads++;
  s.lastError = "";
}

void describe(JsonObject out, const Sensor &s) {
  out["found"] = s.address != 0;
  out["address"] = s.address;
  out["valid"] = s.valid;
  out["reads"] = s.reads;
  out["errors"] = s.errors;
  out["lastError"] = s.lastError;
}

}  // namespace

void begin() {
  Wire.begin(pins::I2C_SDA, pins::I2C_SCL, 100000);
  Wire.setTimeOut(50);  // a missing sensor must not stall loop()
}

void tick() {
  Sensor s, b;
  Reading r;
  {
    StateLock lock;
    s = sht;
    b = bh;
    r = current;
  }
  tickSht30(s, r);
  tickBh1750(b, r);
  r.climateValid = s.valid;
  r.lightValid = b.valid;
  // Log when a sensor appears or stops answering
  if (s.valid != sht.valid) s.valid ? eventlog::info("sensors", "sensorOk", "SHT30") : eventlog::warning("sensors", "sensorLost", (String("SHT30 · ") + s.lastError).c_str());
  if (b.valid != bh.valid) b.valid ? eventlog::info("sensors", "sensorOk", "BH1750") : eventlog::warning("sensors", "sensorLost", (String("BH1750 · ") + b.lastError).c_str());
  StateLock lock;
  sht = s;
  bh = b;
  current = r;
}

Reading reading() { return current; }
bool sht30Ok() { return sht.valid; }
bool bh1750Ok() { return bh.valid; }

void diagnostics(JsonObject out) {
  describe(out["sht30"].to<JsonObject>(), sht);
  describe(out["bh1750"].to<JsonObject>(), bh);
}

}  // namespace climate
