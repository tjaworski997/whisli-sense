#include "peers.h"

#include <WiFi.h>
#include <mdns.h>

#include "device.h"
#include "lock.h"

namespace peers {
namespace {

constexpr uint32_t QUERY_FAST_MS = 10000;  // the first three queries after start
constexpr uint32_t QUERY_MS = 60000;
constexpr uint32_t EXPIRE_MS = 200000;     // gone after ~3 missed queries
constexpr uint8_t MAX_PEERS = 16;

struct Peer {
  String name, host;
  uint32_t ip;  // lwIP byte order
  uint32_t seenAt;
};

Peer peers[MAX_PEERS];  // shared (StateLock)
uint8_t count = 0;
mdns_search_once_t *search = nullptr;
uint32_t queriedAt = 0;
uint8_t queries = 0;

void upsert(const char *name, const char *host, uint32_t ip) {
  uint8_t i = 0;
  while (i < count && peers[i].ip != ip) i++;
  if (i == count) {
    if (count == MAX_PEERS) return;
    count++;
  }
  peers[i] = {name, host, ip, millis()};
}

void collect(mdns_result_t *results) {
  const uint32_t self = WiFi.localIP();
  StateLock lock;
  for (mdns_result_t *r = results; r; r = r->next) {
    uint32_t ip = 0;
    for (mdns_ip_addr_t *a = r->addr; a && !ip; a = a->next)
      if (a->addr.type == ESP_IPADDR_TYPE_V4) ip = a->addr.u_addr.ip4.addr;
    if (!ip || ip == self) continue;
    const char *host = r->hostname ? r->hostname : "";
    const char *name = host;
    for (size_t i = 0; i < r->txt_count; i++)
      if (!strcmp(r->txt[i].key, "name") && r->txt[i].value) name = r->txt[i].value;
    upsert(name, host, ip);
  }
  for (int i = count - 1; i >= 0; i--)
    if (millis() - peers[i].seenAt > EXPIRE_MS) peers[i] = peers[--count];
}

}  // namespace

void loop() {
  if (!WiFi.isConnected()) return;
  if (search) {
    mdns_result_t *results = nullptr;
    uint8_t found = 0;
    if (!mdns_query_async_get_results(search, 0, &results, &found)) return;  // still running
    collect(results);
    if (results) mdns_query_results_free(results);
    stopSearch();
    return;
  }
  if (queriedAt && millis() - queriedAt < (queries < 3 ? QUERY_FAST_MS : QUERY_MS)) return;
  queriedAt = millis() | 1;  // never 0, which means "not queried yet"
  search = mdns_query_async_new(nullptr, "_whisli-sense", "_tcp", MDNS_TYPE_PTR, 3000, MAX_PEERS, nullptr);
  if (search) queries++;
}

void stopSearch() {
  if (!search) return;
  mdns_query_async_delete(search);
  search = nullptr;
}

void list(JsonArray out) {
  JsonObject self = out.add<JsonObject>();
  self["self"] = true;
  self["name"] = device::name();
  self["host"] = device::hostname();
  self["ip"] = WiFi.localIP().toString();
  for (uint8_t i = 0; i < count; i++) {
    JsonObject p = out.add<JsonObject>();
    p["self"] = false;
    p["name"] = peers[i].name;
    p["host"] = peers[i].host;
    p["ip"] = IPAddress(peers[i].ip).toString();
    p["seenAgo"] = (millis() - peers[i].seenAt) / 1000;
  }
}

}  // namespace peers
