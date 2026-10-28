#include "auth.h"

#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <esp_random.h>
#include <mbedtls/base64.h>
#include <mbedtls/pkcs5.h>

#include <time.h>

#include <mutex>

#include "board.h"
#include "eventlog.h"

namespace auth {
namespace {

constexpr const char *NVS = "sense-auth";
constexpr uint32_t ITERATIONS = 1000;  // PBKDF2-SHA256; ~tens of ms on the C3
constexpr uint8_t SESSIONS = 6;
constexpr uint32_t REMEMBER_S = REMEMBER_DAYS * 86400UL;
constexpr time_t CLOCK_SET_AFTER = 1700000000;  // until SNTP answers, time() counts from 1970
constexpr uint32_t FAIL_PAUSE_MS = 2000;
constexpr uint32_t RESET_HOLD_MS = 10000;

std::recursive_mutex mutex;
bool custom = false;  // false = the default password is in use
uint8_t salt[16], hash[32];
struct Session {
  String token;
  uint32_t usedAt = 0;
  bool remembered = false;  // kept in NVS, survives restarts
  uint32_t expires = 0;     // remembered: unix time; 0 = the clock was not set yet
} sessions[SESSIONS];

// NVS blob of the remembered sessions
struct Stored {
  char token[33];
  uint32_t expires;
};
uint32_t failedAt = 0;
uint32_t bootPressedAt = 0;
bool resetDone = false;

void derive(const String &password, const uint8_t *withSalt, uint8_t *out) {
  mbedtls_pkcs5_pbkdf2_hmac_ext(MBEDTLS_MD_SHA256, (const unsigned char *)password.c_str(), password.length(),
                                withSalt, sizeof(salt), ITERATIONS, sizeof(hash), out);
}

bool matches(const String &password) {
  if (!custom) return password == DEFAULT_PASSWORD;
  uint8_t out[sizeof(hash)];
  derive(password, salt, out);
  uint8_t diff = 0;  // constant time
  for (size_t i = 0; i < sizeof(hash); i++) diff |= out[i] ^ hash[i];
  return diff == 0;
}

String cookieToken(AsyncWebServerRequest *request) {
  const AsyncWebHeader *header = request->getHeader("Cookie");
  if (!header) return "";
  const String &cookies = header->value();
  const String key = String(COOKIE) + "=";
  int start = cookies.indexOf(key);
  if (start < 0) return "";
  start += key.length();
  const int end = cookies.indexOf(';', start);
  return cookies.substring(start, end < 0 ? cookies.length() : end);
}

String basicPassword(AsyncWebServerRequest *request) {
  const AsyncWebHeader *header = request->getHeader("Authorization");
  if (!header || !header->value().startsWith("Basic ")) return "";
  const String encoded = header->value().substring(6);
  unsigned char decoded[128];
  size_t length = 0;
  if (mbedtls_base64_decode(decoded, sizeof(decoded) - 1, &length, (const unsigned char *)encoded.c_str(),
                            encoded.length()) != 0)
    return "";
  decoded[length] = '\0';
  const char *colon = strchr((const char *)decoded, ':');  // user:password, the user is not checked
  return colon ? String(colon + 1) : "";
}

void clearSessions() {
  for (Session &s : sessions) s = Session();
}

uint32_t unixTime() {
  const time_t now = time(nullptr);
  return now > CLOCK_SET_AFTER ? now : 0;
}

void saveRemembered() {
  Stored stored[SESSIONS] = {};
  for (uint8_t i = 0; i < SESSIONS; i++) {
    if (!sessions[i].remembered) continue;
    strlcpy(stored[i].token, sessions[i].token.c_str(), sizeof(stored[i].token));
    stored[i].expires = sessions[i].expires;
  }
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putBytes("sessions", stored, sizeof(stored));
  prefs.end();
}

// Without a clock the browser's cookie expiry is the only limit; once the clock is known, a
// session remembered without one gets its 30 days from then.
bool expired(Session &s) {
  if (!s.remembered) return false;
  const uint32_t now = unixTime();
  if (!now) return false;
  if (!s.expires) {
    s.expires = now + REMEMBER_S;
    saveRemembered();
    return false;
  }
  if (now < s.expires) return false;
  s = Session();
  saveRemembered();
  return true;
}

}  // namespace

void begin() {
  pinMode(pins::BOOT, INPUT_PULLUP);
  Preferences prefs;
  prefs.begin(NVS, true);
  custom = prefs.getBytes("salt", salt, sizeof(salt)) == sizeof(salt) &&
           prefs.getBytes("hash", hash, sizeof(hash)) == sizeof(hash);
  Stored stored[SESSIONS] = {};
  if (prefs.getBytesLength("sessions") == sizeof(stored)) prefs.getBytes("sessions", stored, sizeof(stored));
  prefs.end();
  for (uint8_t i = 0; i < SESSIONS; i++) {
    if (!stored[i].token[0]) continue;
    stored[i].token[sizeof(stored[i].token) - 1] = '\0';
    sessions[i].token = stored[i].token;
    sessions[i].remembered = true;
    sessions[i].expires = stored[i].expires;
  }
}

void loop() {
  if (digitalRead(pins::BOOT) == HIGH) {
    bootPressedAt = 0;
    resetDone = false;
    return;
  }
  if (!bootPressedAt) bootPressedAt = millis() | 1;
  if (resetDone || millis() - bootPressedAt < RESET_HOLD_MS) return;
  resetDone = true;
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.clear();
  prefs.end();
  std::lock_guard<std::recursive_mutex> lock(mutex);
  custom = false;
  clearSessions();
  eventlog::warning("system", "passwordReset");
}

bool resetting() { return bootPressedAt && millis() - bootPressedAt >= 1000 && !resetDone; }

bool allowed(AsyncWebServerRequest *request) {
  std::lock_guard<std::recursive_mutex> lock(mutex);
  const String token = cookieToken(request);
  if (token.length()) {
    for (Session &s : sessions) {
      if (s.token == token) {
        if (expired(s)) break;
        s.usedAt = millis();
        return true;
      }
    }
  }
  const String password = basicPassword(request);
  return password.length() && matches(password);
}

Login login(const String &password, bool remember, String &token) {
  std::lock_guard<std::recursive_mutex> lock(mutex);
  if (failedAt && millis() - failedAt < FAIL_PAUSE_MS) return Login::tooSoon;
  if (!matches(password)) {
    failedAt = millis() | 1;
    return Login::wrongPassword;
  }
  uint8_t random[16];
  esp_fill_random(random, sizeof(random));
  char hex[sizeof(random) * 2 + 1];
  for (size_t i = 0; i < sizeof(random); i++) sprintf(hex + 2 * i, "%02x", random[i]);
  // Replace the least recently used session, a not remembered one if there is any
  Session *oldest = &sessions[0];
  for (Session &s : sessions)
    if (s.remembered < oldest->remembered || (s.remembered == oldest->remembered && s.usedAt < oldest->usedAt)) oldest = &s;
  const bool wasRemembered = oldest->remembered;
  oldest->token = hex;
  oldest->usedAt = millis();
  oldest->remembered = remember;
  oldest->expires = remember && unixTime() ? unixTime() + REMEMBER_S : 0;
  if (remember || wasRemembered) saveRemembered();
  token = hex;
  return Login::ok;
}

void logout(AsyncWebServerRequest *request) {
  std::lock_guard<std::recursive_mutex> lock(mutex);
  const String token = cookieToken(request);
  for (Session &s : sessions) {
    if (!token.length() || s.token != token) continue;
    const bool wasRemembered = s.remembered;
    s = Session();
    if (wasRemembered) saveRemembered();
  }
}

bool changePassword(const String &current, const String &next) {
  std::lock_guard<std::recursive_mutex> lock(mutex);
  if (!matches(current)) return false;
  esp_fill_random(salt, sizeof(salt));
  derive(next, salt, hash);
  Preferences prefs;
  prefs.begin(NVS, false);
  prefs.putBytes("salt", salt, sizeof(salt));
  prefs.putBytes("hash", hash, sizeof(hash));
  prefs.end();
  custom = true;
  return true;
}

bool usingDefault() {
  std::lock_guard<std::recursive_mutex> lock(mutex);
  return !custom;
}

}  // namespace auth
