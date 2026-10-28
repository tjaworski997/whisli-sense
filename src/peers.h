#pragma once
// Other sensors on the network. Each sensor announces itself over mDNS as _whisli-sense._tcp
// (TXT "name") and now and then asks who else is there. The panel then connects to every sensor
// directly (ws://<ip>/api/v1/live), so sensors never pass readings to each other.
#include <ArduinoJson.h>

namespace peers {

void loop();        // loop(), without StateLock
void stopSearch();  // before MDNS.end()
void list(JsonArray out);  // with StateLock: this sensor first, then the others

}  // namespace peers
