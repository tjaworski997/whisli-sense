// Copy to src/local_defaults.h (ignored by git) to build firmware that joins your Wi-Fi straight
// away, e.g. for boards updated over the air from the prototype. It is used only until Wi-Fi is
// saved in the panel. Without it, a new board opens the "Whisli-Sense-XXXX" access point.
#pragma once
#define DEFAULT_WIFI_SSID "my-network"
#define DEFAULT_WIFI_PASSWORD "my-password"
