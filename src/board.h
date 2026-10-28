#pragma once
// Wiring and fixed settings. Board: Waveshare ESP32-C3-Zero.
// Avoid GPIO 2, 8, 9 for new wiring (strapping pins) and 18/19 (USB).

namespace pins {
constexpr int I2C_SDA = 4;    // SHT30 + BH1750
constexpr int I2C_SCL = 5;
constexpr int RADAR_RX = 6;   // ESP RX <- radar TX
constexpr int RADAR_TX = 7;   // ESP TX -> radar RX
constexpr int RADAR_OUT = 3;  // radar OT2, high while someone is present
constexpr int LED = 10;       // on-board WS2812
constexpr int BOOT = 9;       // BOOT button; holding it 10 s resets the panel password
}  // namespace pins

// Panel password and access point password until the user changes them.
constexpr const char *DEFAULT_PASSWORD = "whisli_gogo";
