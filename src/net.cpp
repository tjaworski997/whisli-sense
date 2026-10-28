#include "net.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include <algorithm>
#include <vector>

#include "board.h"
#include "device.h"
#include "eventlog.h"
#include "lock.h"
#include "peers.h"

// Optional, not in git: Wi-Fi used until one is saved in the panel (see local_defaults.example.h)
#if __has_include("local_defaults.h")
#include "local_defaults.h"
#endif
#ifndef DEFAULT_WIFI_SSID
#define DEFAULT_WIFI_SSID ""
#define DEFAULT_WIFI_PASSWORD ""
#endif

namespace net {
namespace {

constexpr uint32_t AP_AFTER_MS = 60000;
constexpr const char *NVS = "sense-wifi";
constexpr size_t MAX_NETWORKS = 20;

struct Network {
  String ssid;
  int rssi;
  bool secure;
};

// Shared (StateLock)
String ssid, apPassword;
enum class Action : uint8_t { none, connect, forget, apPassword } action = Action::none;
String nextSsid, nextPassword;
bool scanRequested = false, scanning = false;
std::vector<Network> networks;
bool apActive = false;

// loop() only
String password;
uint32_t offlineSince = 0;
bool wasConnected = false;
uint32_t announcedName = 0;

String apSsid() {
  String id = device::id();
  id.toUpperCase();
  return "Whisli-Sense-" + id;
}

void save(const char *key, const String &value) {
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putString(key, value);
  prefs.end();
}

uint32_t disconnects = 0, connectedAt = 0;  // for diagnostics

void startAp() {
  WiFi.mode(WIFI_AP_STA);
  String pass;
  {
    StateLock lock;
    pass = apPassword;
    apActive = true;
  }
  WiFi.softAP(apSsid().c_str(), pass.c_str());
  eventlog::info("network", "apStarted", apSsid().c_str());
}

void stopAp() {
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  eventlog::info("network", "apStopped");
  StateLock lock;
  apActive = false;
}

void announce() {
  String host, name;
  {
    StateLock lock;
    host = device::hostname();
    name = device::name();
    announcedName = device::nameVersion();
  }
  peers::stopSearch();  // MDNS.end() would invalidate a running query
  MDNS.end();
  MDNS.begin(host.c_str());
  MDNS.addService("http", "tcp", 80);
  MDNS.addService("whisli-sense", "tcp", 80);
  MDNS.addServiceTxt("whisli-sense", "tcp", "name", name.c_str());

}

void collectScan() {
  const int16_t found = WiFi.scanComplete();
  if (found == WIFI_SCAN_RUNNING) return;
  std::vector<Network> list;  // stays empty when the scan failed
  for (int16_t i = 0; i < found; i++) {
    const String name = WiFi.SSID(i);
    if (name.isEmpty()) continue;
    auto same = std::find_if(list.begin(), list.end(), [&](const Network &n) { return n.ssid == name; });
    if (same == list.end()) list.push_back({name, WiFi.RSSI(i), WiFi.encryptionType(i) != WIFI_AUTH_OPEN});
    else same->rssi = std::max<int>(same->rssi, WiFi.RSSI(i));  // several access points, one network
  }
  WiFi.scanDelete();
  std::sort(list.begin(), list.end(), [](const Network &a, const Network &b) { return a.rssi > b.rssi; });
  if (list.size() > MAX_NETWORKS) list.resize(MAX_NETWORKS);
  StateLock lock;
  networks = list;
  scanning = false;
}

}  // namespace

void begin() {
  Preferences prefs;
  prefs.begin(NVS, true);
  const bool saved = prefs.isKey("ssid");
  ssid = saved ? prefs.getString("ssid", "") : DEFAULT_WIFI_SSID;
  password = saved ? prefs.getString("password", "") : DEFAULT_WIFI_PASSWORD;
  apPassword = prefs.getString("apPassword", DEFAULT_PASSWORD);
  prefs.end();

  WiFi.persistent(false);  // credentials live in our NVS namespace only
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(device::hostname().c_str());
  WiFi.setAutoReconnect(true);
  if (ssid.length()) WiFi.begin(ssid.c_str(), password.c_str());
  offlineSince = millis();
}

void loop() {
  Action todo;
  String newSsid, newPassword;
  bool scan;
  {
    StateLock lock;
    todo = action;
    action = Action::none;
    newSsid = nextSsid;
    newPassword = nextPassword;
    scan = scanRequested && !scanning;
    if (scan) scanRequested = false, scanning = true;
  }

  if (todo == Action::connect || todo == Action::forget) {
    save("ssid", newSsid);
    save("password", newPassword);
    password = newPassword;
    {
      StateLock lock;
      ssid = newSsid;
    }
    WiFi.disconnect();
    if (newSsid.length()) WiFi.begin(newSsid.c_str(), newPassword.c_str());
    eventlog::info("network", newSsid.length() ? "wifiChanged" : "wifiForgotten", newSsid.c_str());
    offlineSince = millis();
  } else if (todo == Action::apPassword) {
    save("apPassword", newPassword);
    if (apActive) startAp();  // restarts with the new password
  }

  if (scan && WiFi.scanNetworks(true) == WIFI_SCAN_FAILED) {
    StateLock lock;
    scanning = false;
  }
  if (scanning) collectScan();

  const bool isConnected = WiFi.isConnected();
  if (isConnected && !wasConnected) {
    connectedAt = millis();
    eventlog::info("network", "wifiConnected", (WiFi.localIP().toString() + " · " + WiFi.RSSI() + " dBm").c_str());
    announce();
  }
  if (!isConnected && wasConnected) {
    offlineSince = millis();
    disconnects++;
    eventlog::warning("network", "wifiLost");
  }
  wasConnected = isConnected;

  uint32_t nameNow;
  bool hasSsid;
  {
    StateLock lock;
    nameNow = device::nameVersion();
    hasSsid = ssid.length();
  }
  if (isConnected && nameNow != announcedName) {
    WiFi.setHostname(device::hostname().c_str());  // used from the next DHCP request
    announce();
  }

  if (isConnected && apActive && WiFi.softAPgetStationNum() == 0) stopAp();
  if (!isConnected && !apActive && (!hasSsid || millis() - offlineSince >= AP_AFTER_MS)) startAp();
}

bool connected() { return WiFi.isConnected(); }

void status(JsonObject out) {
  JsonObject sta = out["wifi"].to<JsonObject>();
  sta["ssid"] = ssid;
  sta["connected"] = WiFi.isConnected();
  if (WiFi.isConnected()) {
    sta["ip"] = WiFi.localIP().toString();
    sta["rssi"] = WiFi.RSSI();
    sta["channel"] = WiFi.channel();
  }
  sta["hostname"] = device::hostname();
  JsonObject ap = out["ap"].to<JsonObject>();
  ap["ssid"] = apSsid();
  ap["active"] = apActive;
  if (apActive) {
    ap["ip"] = WiFi.softAPIP().toString();
    ap["clients"] = WiFi.softAPgetStationNum();
  }
  ap["defaultPassword"] = apPassword == DEFAULT_PASSWORD;
}

void connect(const String &newSsid, const String &newPassword) {
  action = Action::connect;
  nextSsid = newSsid;
  nextPassword = newPassword;
}

void forget() {
  action = Action::forget;
  nextSsid = nextPassword = "";
}

void setApPassword(const String &newPassword) {
  apPassword = newPassword;
  action = Action::apPassword;
  nextPassword = newPassword;
}

void startScan() { scanRequested = true; }

void diagnostics(JsonObject out) {
  out["ssid"] = ssid;
  out["connected"] = WiFi.isConnected();
  out["hostname"] = device::hostname();
  out["mac"] = WiFi.macAddress();
  out["disconnects"] = disconnects;
  out["ap"] = apActive;
  if (!WiFi.isConnected()) return;
  out["bssid"] = WiFi.BSSIDstr();
  out["channel"] = WiFi.channel();
  out["rssi"] = WiFi.RSSI();
  out["ip"] = WiFi.localIP().toString();
  out["gateway"] = WiFi.gatewayIP().toString();
  out["subnet"] = WiFi.subnetMask().toString();
  out["dns"] = WiFi.dnsIP().toString();
  out["connectedFor"] = (millis() - connectedAt) / 1000;
}

void scanResults(JsonObject out) {
  out["scanning"] = scanning || scanRequested;
  JsonArray list = out["networks"].to<JsonArray>();
  for (const Network &n : networks) {
    JsonObject item = list.add<JsonObject>();
    item["ssid"] = n.ssid;
    item["rssi"] = n.rssi;
    item["secure"] = n.secure;
  }
}

}  // namespace net
