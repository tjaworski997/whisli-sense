#pragma once
// Temperature and humidity (SHT30) and light (BH1750), both on I2C.
#include <ArduinoJson.h>

namespace climate {

struct Reading {
  bool climateValid = false;  // temperature + humidity
  float temperature = 0;      // °C
  float humidity = 0;         // %
  bool lightValid = false;
  float lux = 0;
};

void begin();
void tick();  // loop(), once a second; does I2C, so call it without StateLock

// With StateLock held:
Reading reading();
bool sht30Ok();
bool bh1750Ok();
void diagnostics(JsonObject out);  // addresses, read/error counters, last error

}  // namespace climate
