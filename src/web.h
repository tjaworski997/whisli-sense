#pragma once
// Web server: the panel at "/", the JSON API under /api/v1 and two WebSockets:
//   /api/v1/ws    full live state for the panel (signed in)
//   /api/v1/live  short summary for the sensors overview on other sensors' panels (open)
// POST requests take form fields; answers are JSON, errors {"error":"<code>"}.

namespace web {

void begin();
void loop();  // loop(), without StateLock: pushes live state, restarts after OTA

}  // namespace web
