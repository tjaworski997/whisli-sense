#include "eventlog.h"

#include <Arduino.h>
#include <esp_random.h>

namespace eventlog {
namespace {

constexpr uint16_t CAPACITY = 120;  // ~11 KB; the C3 has no PSRAM
const char *const LEVEL_NAMES[] = {"info", "warning", "error"};

struct Entry {
  uint32_t id, ms;
  Level level;
  char category[10];
  char code[24];
  char detail[56];
};

Entry entries[CAPACITY];
uint32_t nextId = 1;  // entries[(id - 1) % CAPACITY]
const uint32_t session = esp_random();  // changes on every start, so the panel knows to reload
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

}  // namespace

void add(Level level, const char *category, const char *code, const char *detail) {
  Entry e;
  e.ms = millis();
  e.level = level;
  strlcpy(e.category, category, sizeof(e.category));
  strlcpy(e.code, code, sizeof(e.code));
  strlcpy(e.detail, detail ? detail : "", sizeof(e.detail));
  portENTER_CRITICAL(&mux);
  e.id = nextId++;
  entries[(e.id - 1) % CAPACITY] = e;
  portEXIT_CRITICAL(&mux);
  Serial.printf("[%s] %s %s\n", category, code, e.detail);
}

void info(const char *category, const char *code, const char *detail) { add(Level::info, category, code, detail); }
void warning(const char *category, const char *code, const char *detail) { add(Level::warning, category, code, detail); }
void error(const char *category, const char *code, const char *detail) { add(Level::error, category, code, detail); }

void toJson(JsonObject out, uint32_t after, uint32_t before, uint16_t limit, const char *level, const char *category) {
  // Copy under the lock, build JSON outside it
  static Entry copy[CAPACITY];
  uint32_t last;
  portENTER_CRITICAL(&mux);
  memcpy(copy, entries, sizeof(entries));
  last = nextId - 1;
  portEXIT_CRITICAL(&mux);

  const uint32_t first = last > CAPACITY ? last - CAPACITY + 1 : 1;
  const uint32_t from = after ? max(after + 1, first) : first;
  const uint32_t to = before ? min(before - 1, last) : last;
  // Walk back from the newest so `limit` keeps the most recent matches, then emit oldest first
  uint32_t picked[CAPACITY];
  uint16_t count = 0;
  bool more = false;
  for (uint32_t id = to; id >= from && id > 0; id--) {
    const Entry &e = copy[(id - 1) % CAPACITY];
    if (*level && strcmp(LEVEL_NAMES[(int)e.level], level)) continue;
    if (*category && strcmp(e.category, category)) continue;
    if (count == limit) {
      more = true;
      break;
    }
    picked[count++] = id;
  }
  out["sessionId"] = session;
  out["capacity"] = CAPACITY;
  out["hasMore"] = more;  // older matching entries than the oldest returned
  JsonArray list = out["entries"].to<JsonArray>();
  for (int i = count - 1; i >= 0; i--) {
    const Entry &e = copy[(picked[i] - 1) % CAPACITY];
    JsonObject item = list.add<JsonObject>();
    item["id"] = e.id;
    item["uptimeMs"] = e.ms;
    item["level"] = LEVEL_NAMES[(int)e.level];
    item["category"] = e.category;
    item["code"] = e.code;
    item["detail"] = e.detail;
  }
}

}  // namespace eventlog
