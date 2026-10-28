#include "device.h"

#include <Preferences.h>
#include <esp_mac.h>

namespace device {
namespace {

String currentName, currentHostname;
uint32_t version = 0;

// "Kuchnia Górna" -> "whisli-kuchnia-gorna": Polish letters become Latin, anything else outside
// [a-z0-9] becomes '-'.
String makeHostname(const String &name) {
  static const char *const POLISH[][2] = {{"ą", "a"}, {"ć", "c"}, {"ę", "e"}, {"ł", "l"}, {"ń", "n"}, {"ó", "o"},
                                          {"ś", "s"}, {"ź", "z"}, {"ż", "z"}, {"Ą", "a"}, {"Ć", "c"}, {"Ę", "e"},
                                          {"Ł", "l"}, {"Ń", "n"}, {"Ó", "o"}, {"Ś", "s"}, {"Ź", "z"}, {"Ż", "z"}};
  String slug;
  for (const char *p = name.c_str(); *p && slug.length() < 30;) {
    char c = '-';
    if ((uint8_t)*p >= 0x80) {
      for (auto &letter : POLISH)
        if (!strncmp(p, letter[0], strlen(letter[0]))) c = letter[1][0];
      p++;
      while (((uint8_t)*p & 0xC0) == 0x80) p++;  // rest of the UTF-8 character
    } else {
      c = tolower(*p++);
    }
    if (!isalnum((uint8_t)c)) c = '-';
    if (c == '-' && (slug.isEmpty() || slug.endsWith("-"))) continue;
    slug += c;
  }
  while (slug.endsWith("-")) slug.remove(slug.length() - 1);
  if (slug.isEmpty()) return "whisli-sense-" + id();
  return slug.startsWith("whisli") ? slug : "whisli-" + slug;
}

void use(const String &name) {
  currentName = name;
  currentHostname = makeHostname(name);
  version++;
}

}  // namespace

String id() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);  // works before Wi-Fi is started
  char text[5];
  snprintf(text, sizeof(text), "%02x%02x", mac[4], mac[5]);
  return text;
}

void begin() {
  Preferences prefs;
  prefs.begin("sense", true);
  String saved = prefs.getString("name", "");
  prefs.end();
  if (saved.isEmpty()) {  // a board that ran the prototype firmware keeps its name
    prefs.begin("whisli", true);
    saved = prefs.getString("name", "");
    prefs.end();
  }
  String suffix = id();
  suffix.toUpperCase();
  use(saved.isEmpty() ? "Whisli Sense " + suffix : saved);
}

String name() { return currentName; }
String hostname() { return currentHostname; }
uint32_t nameVersion() { return version; }

bool setName(const String &requested) {
  String name = requested;
  name.trim();
  if (name.isEmpty() || name.length() > MAX_NAME_LENGTH) return false;
  Preferences prefs;
  prefs.begin("sense", false);
  prefs.putString("name", name);
  prefs.end();
  use(name);
  return true;
}

}  // namespace device
