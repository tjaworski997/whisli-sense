#include "state.h"

#include <WiFi.h>
#include <time.h>

#include "calibration.h"
#include "climate.h"
#include "device.h"
#include "extremes.h"
#include "generated/version.h"
#include "mqtt.h"
#include "radar.h"

namespace state {
namespace {

constexpr uint32_t STARTUP_GRACE_MS = 5000;  // sensors get a moment before they count as missing
constexpr time_t CLOCK_SET_AFTER = 1700000000;  // until SNTP answers, time() counts from 1970

void readings(JsonObject out) {
  out["presence"] = radar::presence();
  out["distance"] = radar::distanceCm();
  const climate::Reading c = climate::reading();
  if (c.climateValid) {
    out["temperature"] = serialized(String(c.temperature, 1));
    out["humidity"] = serialized(String(c.humidity, 0));
  } else {
    out["temperature"] = nullptr;
    out["humidity"] = nullptr;
  }
  if (c.lightValid) out["lux"] = serialized(String(c.lux, 0));
  else out["lux"] = nullptr;
}

template <typename T>
void array(JsonObject out, const char *key, const T *values) {
  JsonArray list = out[key].to<JsonArray>();
  for (uint8_t g = 0; g < radar::GATES; g++) list.add(values[g]);
}

// Loop timing over the last 10 s window and the one before it (so the numbers never read empty)
struct LoopWindow {
  uint32_t count = 0, totalUs = 0, maxUs = 0;
};
LoopWindow loopNow, loopLast;
uint32_t loopWindowAt = 0;

}  // namespace

const char *resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "powerOn";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_USB: return "usb";
    default: return "other";
  }
}

void recordLoop(uint32_t micros) {
  loopNow.count++;
  loopNow.totalUs += micros;
  loopNow.maxUs = max(loopNow.maxUs, micros);
  if (millis() - loopWindowAt >= 10000) {
    loopWindowAt = millis();
    loopLast = loopNow;
    loopNow = LoopWindow();
  }
}

void system(JsonObject out) {
  out["version"] = FIRMWARE_VERSION;
  out["uptime"] = millis() / 1000;
  out["resetReason"] = resetReason();
  out["chip"] = ESP.getChipModel();
  out["chipRevision"] = ESP.getChipRevision();
  out["cpuMhz"] = ESP.getCpuFreqMHz();
  out["sdk"] = ESP.getSdkVersion();
  out["heap"] = ESP.getFreeHeap();
  out["heapTotal"] = ESP.getHeapSize();
  out["minHeap"] = ESP.getMinFreeHeap();
  out["maxBlock"] = ESP.getMaxAllocHeap();
  out["flash"] = ESP.getFlashChipSize();
  out["firmwareSize"] = ESP.getSketchSize();
  out["firmwareSpace"] = ESP.getFreeSketchSpace();
  const LoopWindow &w = loopLast.count ? loopLast : loopNow;
  out["loopPerSecond"] = w.count / 10;
  out["loopAverageUs"] = w.count ? w.totalUs / w.count : 0;
  out["loopMaxUs"] = w.maxUs;
}

void full(JsonObject out) {
  out["name"] = device::name();
  out["hostname"] = device::hostname();
  out["version"] = FIRMWARE_VERSION;
  out["uptime"] = millis() / 1000;
  readings(out);
  extremes::describe(out["extremes"].to<JsonObject>());
  problems(out["problems"].to<JsonArray>());

  JsonObject r = out["radar"].to<JsonObject>();
  r["working"] = radar::working();
  r["loaded"] = radar::settingsLoaded();
  r["busy"] = radar::busy();
  const radar::Settings &s = radar::settings();
  r["minGate"] = s.minGate;
  r["maxGate"] = s.maxGate;
  r["delay"] = s.delay;
  array(r, "trigger", s.trigger);
  array(r, "hold", s.hold);
  array(r, "energy", radar::energy());

  calibration::status(out["calibration"].to<JsonObject>());
  out["mqtt"] = mqtt::state();
  out["rssi"] = WiFi.isConnected() ? WiFi.RSSI() : 0;
  out["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : "";
  out["mac"] = WiFi.macAddress();
  out["heap"] = ESP.getFreeHeap();
  const time_t now = time(nullptr);
  if (now > CLOCK_SET_AFTER) out["clock"] = now;  // unix time from SNTP
  else out["clock"] = nullptr;
}

void summary(JsonObject out) {
  out["name"] = device::name();
  out["host"] = device::hostname();
  out["version"] = FIRMWARE_VERSION;
  readings(out);
  out["problems"] = problemCount();
  out["rssi"] = WiFi.isConnected() ? WiFi.RSSI() : 0;
  out["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : "";
  out["mac"] = WiFi.macAddress();
}

void problems(JsonArray out) {
  if (millis() < STARTUP_GRACE_MS) return;
  if (const char *radarProblem = radar::problem()) out.add(radarProblem);
  if (!climate::sht30Ok()) out.add("sht30");
  if (!climate::bh1750Ok()) out.add("bh1750");
  if (!strcmp(mqtt::state(), "error")) out.add("mqtt");
}

size_t problemCount() {
  JsonDocument doc;
  problems(doc.to<JsonArray>());
  return doc.size();
}

}  // namespace state
