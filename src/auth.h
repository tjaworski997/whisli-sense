#pragma once
// One panel password (default whisli_gogo). The panel signs in and gets a session cookie;
// scripts send HTTP Basic (any user name, e.g. whisli:<password>). Holding BOOT for 10 s
// restores the default password. Safe to call from any task: it has its own lock.
#include <Arduino.h>

class AsyncWebServerRequest;

namespace auth {

void begin();
void loop();  // watches the BOOT button

bool allowed(AsyncWebServerRequest *request);
// On success fills the session token for the cookie. A remembered session is kept in NVS for
// REMEMBER_DAYS, so it survives restarts and updates. After a wrong password further attempts
// are refused for 2 s.
enum class Login { ok, wrongPassword, tooSoon };
Login login(const String &password, bool remember, String &token);
void logout(AsyncWebServerRequest *request);
bool changePassword(const String &current, const String &next);
bool usingDefault();
bool resetting();  // BOOT is being held

constexpr const char *COOKIE = "sense_session";
constexpr uint32_t REMEMBER_DAYS = 30;

}  // namespace auth
