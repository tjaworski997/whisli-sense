// Whisli Sense - presence sensor: mmWave radar, temperature, humidity and light.
// Panel at http://<ip>/ (or http://whisli-<name>.local/), JSON API under /api/v1.

#include <Arduino.h>

#include "auth.h"
#include "calibration.h"
#include "climate.h"
#include "device.h"
#include "eventlog.h"
#include "extremes.h"
#include "generated/version.h"
#include "led.h"
#include "lock.h"
#include "mqtt.h"
#include "net.h"
#include "peers.h"
#include "radar.h"
#include "state.h"
#include "web.h"

void setup() {
  led::begin();
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);  // without a USB host reading, writes would block loop()
  Serial.printf("\nWhisli Sense %s\n", FIRMWARE_VERSION);
  eventlog::info("system", "boot", (String(FIRMWARE_VERSION) + " · " + state::resetReason()).c_str());

  device::begin();
  auth::begin();
  climate::begin();
  radar::begin();
  radar::onFrame(calibration::sample);
  net::begin();
  extremes::begin();
  mqtt::begin();
  web::begin();
}

led::Inputs ledInputs() {
  led::Inputs now;
  now.resetting = auth::resetting();
  now.offline = !net::connected();
  static bool problems = false;
  static uint32_t checkedAt = 0;
  StateLock lock;
  if (millis() - checkedAt >= 500) {  // the problem list builds JSON, so not every loop
    checkedAt = millis();
    problems = state::problemCount() > 0;
  }
  now.problem = problems;
  now.presence = radar::presence();
  now.distanceCm = radar::distanceCm();
  const climate::Reading light = climate::reading();
  now.dark = light.lightValid && light.lux < 5;
  return now;
}

void loop() {
  const uint32_t startedUs = micros();
  {
    StateLock lock;
    radar::loop();
    calibration::loop();
  }

  static uint32_t secondAt = 0;
  if (millis() - secondAt >= 1000) {
    secondAt = millis();
    climate::tick();
    extremes::tick();
  }

  net::loop();
  peers::loop();
  mqtt::loop();
  web::loop();
  auth::loop();
  led::show(ledInputs());
  {
    StateLock lock;
    state::recordLoop(micros() - startedUs);
  }
  delay(1);  // let lower priority tasks (idle, watchdog) run
}
