#pragma once
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

// One lock for all state shared by loop() and the web server task. Module functions that touch
// shared state expect the caller to hold it: loop() takes it around radar and calibration work,
// and every API handler runs under it (see web.cpp). Keep it short - no waiting on Wi-Fi, I2C or
// the radar while holding it; a quick NVS write from a handler is fine.
class StateLock {
 public:
  StateLock() { xSemaphoreTakeRecursive(handle(), portMAX_DELAY); }
  ~StateLock() { xSemaphoreGiveRecursive(handle()); }
  StateLock(const StateLock &) = delete;
  StateLock &operator=(const StateLock &) = delete;

 private:
  static SemaphoreHandle_t handle() {
    static SemaphoreHandle_t mutex = xSemaphoreCreateRecursiveMutex();
    return mutex;
  }
};
