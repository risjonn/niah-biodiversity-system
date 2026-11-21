# ingest-reading API (for the gateway)

How the gateway sends one sensor reading to the cloud. Generated from
`supabase/functions/ingest-reading/index.ts` (commit a787e20). Field names match
[gateway-contract.md](gateway-contract.md).

## Request

|        |                                                                        |
| ------ | ---------------------------------------------------------------------- |
| URL    | `https://qxqgrxumreedwqetxqsn.supabase.co/functions/v1/ingest-reading` |
| Method | `POST`                                                                 |
| Header | `Content-Type: application/json`                                       |
| Header | `x-device-key: <device key, sent privately>`                           |
| Body   | One JSON object = one reading                                          |

Send one reading per request. There is no batch format.

## Fields

`null` is treated the same as leaving a field out. Numbers must be JSON numbers (`23.2`, not
`"23.2"`). True/false fields must be JSON `true` or `false` (not `1`, `0` or `"true"`).

| Field                     | Type       | Required | Allowed                                                                             | Unit            | If missing                       |
| ------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------- | --------------- | -------------------------------- |
| `node_identifier`         | string     | **Yes**  | A registered node name, exact case, e.g. `NODE-01`. Spaces at the ends are trimmed. |                 | 400                              |
| `recorded_at`             | string     | No       | ISO 8601 with a timezone, see [Rules](#rules)                                       |                 | Time the server received it      |
| `motion_detected`         | true/false | No       |                                                                                     |                 | `false`                          |
| `motion_duration_seconds` | number     | No       | 0 or more                                                                           | s               | Not stored                       |
| `temperature`             | number     | No       | -20 to 60                                                                           | °C              | Not stored, no temperature check |
| `humidity`                | number     | No       | 0 to 100                                                                            | %               | Not stored, no humidity check    |
| `latitude`                | number     | No       | -90 to 90, send with `longitude`                                                    | decimal degrees | No position on this reading      |
| `longitude`               | number     | No       | -180 to 180, send with `latitude`                                                   | decimal degrees | No position on this reading      |
| `tilt_angle`              | number     | No       | 0 to 180                                                                            | ° (box)         | Not stored                       |
| `plant_tilt_angle`        | number     | No       | 0 to 180                                                                            | ° (plant)       | Not stored                       |
| `soil_moisture`           | number     | No       | 0 to 100                                                                            | %               | Not stored                       |
| `is_raining`              | true/false | No       |                                                                                     |                 | Not stored                       |
| `tamper_detected`         | true/false | No       |                                                                                     |                 | Not stored                       |
| `human_detected`          | true/false | No       |                                                                                     |                 | Not stored                       |
| `alert_status`            | string     | No       | One of the 16 codes below, exact upper case                                         |                 | No device alert                  |
| `battery_level`           | number     | No       | 0 to 100                                                                            | %               | Node's battery level unchanged   |

Notes:

- Range limits include both ends (`tilt_angle: 180` is accepted, `180.1` is not). Decimals are fine.
- `latitude`/`longitude` are saved on the reading only. They never move the node's position on
  the map, which stays where it was installed.
- `battery_level` is accepted, but the contract says the gateway won't send it. You can leave it
  out.

## Alert codes

`alert_status` must be exactly one of these. Only WARNING and CRITICAL codes raise an alert for the
rangers. INFO codes are saved on the reading and nothing else happens.

| Code                     | Severity | Raises an alert | Meaning                                                    |
| ------------------------ | -------- | --------------- | ---------------------------------------------------------- |
| `NORMAL`                 | INFO     | No              | Everything settled, no issue                               |
| `MOTION_ONLY`            | INFO     | No              | Only the motion sensor triggered, likely wildlife          |
| `TILT_ONLY`              | INFO     | No              | Only the box or plant tilted, no motion                    |
| `WEATHER_STORM`          | INFO     | No              | Tilt and motion with rain or a soil change, likely natural |
| `MAINTENANCE_MODE`       | INFO     | No              | Ranger maintenance is active                               |
| `POACHING_RISK`          | WARNING  | Yes             | Tilt and motion while dry, or a person seen in daytime     |
| `IMPACT_DETECTED`        | WARNING  | Yes             | 3 strong knocks or vibrations within 10 s                  |
| `LOITERING`              | WARNING  | Yes             | Continuous motion for 120 s or more                        |
| `REPEATED_DISTURBANCE`   | WARNING  | Yes             | Several motion or tilt events within 10 minutes            |
| `NIGHT_POACHING_RISK`    | CRITICAL | Yes             | Suspicious activity at night                               |
| `CRITICAL_FALL`          | CRITICAL | Yes             | Box tilted 75° or more                                     |
| `PLANT_STOLEN_MOVING`    | CRITICAL | Yes             | Box GPS moved more than 15 m with tilt or motion           |
| `GPS_SHIELDED_OR_JAMMED` | CRITICAL | Yes             | GPS lost right after movement                              |
| `FIRE_OR_CANOPY_BREACH`  | CRITICAL | Yes             | Rapid heat rise with humidity drop, or extreme heat        |
| `TAMPER_LID_OPENED`      | CRITICAL | Yes             | Enclosure lid opened                                       |
| `POWER_LOSS`             | CRITICAL | Yes             | Battery critically low (last-gasp)                         |

One alert per node per code at a time: while a ranger hasn't acknowledged the alert, more readings
with the same code are saved but don't raise another one (`alert_ids` comes back empty). Once it
is acknowledged, the next reading with that code raises a new alert. So it is fine to keep sending
the current code every minute.

## Rules

- **latitude and longitude together.** Send both or neither. One on its own is a 400.
- **recorded_at** is when the node took the reading, in the form
  `YYYY-MM-DDTHH:MM:SSZ`. Seconds and fractions of a second are optional; the timezone is not.
  Use `Z` (upper case) or an offset like `+08:00`.
  - Accepted: `2026-11-20T14:05:12Z`, `2026-11-20T22:05:12+08:00`, `2026-11-20T14:05:12.250Z`
  - Refused: `2026-11-20T14:05:12` (no timezone), `2026-11-20 14:05:12Z` (space), a Unix
    timestamp number
  - Not more than 5 minutes in the future. There is no limit on how old it can be, so buffered
    readings can be sent late.
  - If the gateway has no reliable clock, leave `recorded_at` out and the server uses the time it
    received the request.
- **Codes are exact upper case.** `"normal"` or `"Normal"` is a 400. The 400 lists the allowed
  codes.
- **Unknown fields are ignored**, not refused (e.g. `rssi`, `gateway_id`). This also means a
  misspelled field (`soil_moisure`) is silently dropped, so check field names against the table.
- **All problems at once.** A 400 lists every problem in the body, not just the first.
- **No duplicate check on readings.** Sending the same reading twice stores it twice.
- **Server-side alerts.** Temperature and humidity outside the park's limits can also raise an
  alert, on any reading. A long `motion_duration_seconds` raises a motion alert only when the
  reading has no `alert_status`; with `alert_status`, the node's own code decides.

## Responses

All bodies are JSON.

| Status | Meaning                               | Example body                                                                                                                  | Gateway should                                                                  |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 201    | Saved                                 | `{"reading_id":"7c1e…","alert_ids":["d93a…"]}`                                                                                | Done. Don't resend.                                                             |
| 400    | Invalid reading                       | `{"error":"Invalid reading","details":["humidity must be between 0 and 100","latitude and longitude must be sent together"]}` | Don't retry. Log `details` and fix the payload.                                 |
| 401    | Missing or wrong device key           | `{"error":"Missing or invalid device key"}`                                                                                   | Don't retry. Check `DEVICE_KEY` in `config.h`.                                  |
| 404    | Node name not registered              | `{"error":"Unknown node NODE-03"}`                                                                                            | Don't retry. Check `node_identifier`, or ask the web team to register the node. |
| 405    | Not a POST                            | `{"error":"Method not allowed, use POST"}`                                                                                    | Don't retry. Use POST.                                                          |
| 409    | Node is switched off in the system    | `{"error":"Node NODE-01 is inactive"}`                                                                                        | Don't retry. Ask the web team to reactivate it.                                 |
| 500    | Server problem, reading **not** saved | `{"error":"Could not save the reading"}` or `{"error":"Server is not configured"}`                                            | Retry later with backoff (e.g. 30 s, 1 min, 2 min…).                            |

More about the responses:

- `alert_ids` is always present on a 201, often `[]`. It lists every alert this reading raised,
  device or temperature/humidity.
- Example 400 for a bad code:
  `{"error":"Invalid reading","details":["alert_status \"normal\" is not a known code. Allowed: CRITICAL_FALL, FIRE_OR_CANOPY_BREACH, …"]}`
- Other 5xx statuses (502, 503, 504) come from Supabase in front of the function. Treat them like
  500 and retry.
- **No response** (timeout, Wi-Fi drop): the reading may or may not have been saved. Retrying is
  usually right, but it can store a duplicate.

## Example requests

### Normal 1-minute reading

```http
POST /functions/v1/ingest-reading HTTP/1.1
Host: <project-ref>.supabase.co
Content-Type: application/json
x-device-key: <device key, sent privately>

{
  "node_identifier": "NODE-01",
  "temperature": 23.2,
  "humidity": 63,
  "motion_detected": false,
  "motion_duration_seconds": 0,
  "recorded_at": "2026-11-20T14:05:12Z"
}
```

Response `201`: `{"reading_id":"…","alert_ids":[]}`

### Alert reading (SEND_EXTRA_FIELDS = true)

```json
{
  "node_identifier": "NODE-01",
  "temperature": 23.2,
  "humidity": 63,
  "motion_detected": true,
  "motion_duration_seconds": 12,
  "latitude": 3.812345,
  "longitude": 113.776543,
  "recorded_at": "2026-11-20T14:05:12Z",
  "tamper_detected": false,
  "tilt_angle": 4.2,
  "soil_moisture": 45,
  "is_raining": false,
  "human_detected": true,
  "alert_status": "POACHING_RISK"
}
```

Response `201`: `{"reading_id":"…","alert_ids":["…"]}`, or `"alert_ids":[]` if a
`POACHING_RISK` alert for NODE-01 is still unacknowledged.

## ESP32 example (Arduino HTTPClient)

`config.h`, kept out of git (add `config.h` to the firmware's `.gitignore` and commit a
`config.example.h` with placeholders instead):

```cpp
#pragma once
#define INGEST_URL "https://<project-ref>.supabase.co/functions/v1/ingest-reading"
#define DEVICE_KEY "<device key, sent privately>"
```

Posting one reading:

```cpp
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "config.h"

// Returns the HTTP status, or a negative number if there was no answer.
int postReading(const char* json) {
  WiFiClientSecure client;
  client.setInsecure();  // bench testing only, see the note below

  HTTPClient http;
  if (!http.begin(client, INGEST_URL)) return -1;
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);  // never print this

  int status = http.POST(json);
  String body = http.getString();  // reading_id/alert_ids, or the error details
  if (status != 201) Serial.printf("ingest-reading %d: %s\n", status, body.c_str());
  http.end();
  return status;
}

void sendReading(float temperature, float humidity, bool motion,
                 unsigned motionSeconds, const char* recordedAtUtc) {
  char json[256];
  snprintf(json, sizeof json,
    "{\"node_identifier\":\"NODE-01\",\"temperature\":%.1f,\"humidity\":%.1f,"
    "\"motion_detected\":%s,\"motion_duration_seconds\":%u,\"recorded_at\":\"%s\"}",
    temperature, humidity, motion ? "true" : "false", motionSeconds, recordedAtUtc);

  int status = postReading(json);
  if (status < 0 || status >= 500) {
    // Not saved (or unknown): keep it and retry later with backoff.
  }
  // 201: done. 400/401/404/405/409: don't retry, fix the cause.
}
```

`recordedAtUtc` looks like `2026-11-20T14:05:12Z`. If the gateway has no clock, drop
`recorded_at` from the JSON.

**TLS note:** `setInsecure()` skips the certificate check, so anyone who can intercept the
gateway's connection could read the device key. For the field, replace it with
`client.setCACert(ROOT_CA)` using the root certificate of `<project-ref>.supabase.co` (export it
from a browser's certificate viewer and put it in `config.h`).
