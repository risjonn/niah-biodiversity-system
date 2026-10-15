# Sensor reading simulator

Sends fake readings to the `ingest-reading` Edge Function, the same way the LoRa gateway
will. Use it to test the endpoint and the threshold alerts before the hardware is ready.

## Setup

Needs Node 24 or newer. No packages to install.

1. Copy `.env.example` to `.env` in this folder.
2. Set `INGEST_URL` to the function URL, e.g.
   `https://<project-ref>.supabase.co/functions/v1/ingest-reading`.
3. Set `DEVICE_INGEST_KEY` to the same value as the function's `DEVICE_INGEST_KEY` secret.

`.env` is gitignored. Never commit the device key.

The node must exist in `sensor_nodes`. `database/seed/002_sample_sensor_nodes.sql` creates
`NIAH-NODE-01` and `NIAH-NODE-02`.

## Running

```
node simulate.js <node_identifier> [scenario] [--interval s] [--count n]
```

| Scenario | What it sends | Expected with the default thresholds |
|---|---|---|
| `normal` (default) | 24–30 °C, 70–90 % humidity, no motion | No alert |
| `hot` | 37–40 °C | `temperature_anomaly` alert |
| `dry` | 35–45 % humidity | `humidity_anomaly` alert |
| `motion` | Motion lasting 15–30 s | `motion_detected` alert |
| `brief-motion` | Motion lasting 2–5 s | No alert (shorter than the 10 s window) |

`--interval` is the number of seconds between readings (default 5). `--count` is the number
of readings to send (default 1).

```
node simulate.js NIAH-NODE-01 hot
node simulate.js NIAH-NODE-02 normal --count 10 --interval 2
```

Each reading and the response status and body are printed. The exit code is 1 if any
request failed.

A node gets at most one unacknowledged alert of each type. Sending `hot` twice creates one
alert, and the second response has an empty `alert_ids`. Acknowledge the alert to get a new
one.

Default thresholds are placeholders: temperature 18 to 35 °C, humidity 50 to 100 %, motion
window 10 seconds. Nodes can have their own limits in `alert_thresholds`.

## Format the gateway must send

```
POST https://<project-ref>.supabase.co/functions/v1/ingest-reading
Content-Type: application/json
x-device-key: <DEVICE_INGEST_KEY>
```

```json
{
  "node_identifier": "NIAH-NODE-01",
  "recorded_at": "2026-10-15T08:30:00Z",
  "temperature": 27.4,
  "humidity": 81,
  "motion_detected": true,
  "motion_duration_seconds": 14,
  "battery_level": 92,
  "latitude": 3.8136,
  "longitude": 113.7801
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `node_identifier` | string | Yes | Must match a node in `sensor_nodes` |
| `recorded_at` | string | No | ISO 8601 with a timezone (`Z` or `+08:00`). Defaults to the time the server receives it. At most 5 minutes in the future |
| `temperature` | number | No | °C, -20 to 60 |
| `humidity` | number | No | %, 0 to 100 |
| `motion_detected` | boolean | No | Defaults to `false` |
| `motion_duration_seconds` | number | No | 0 or more. **Required for motion alerts**, see below |
| `battery_level` | number | No | %, 0 to 100. Updates the node |
| `latitude` | number | No | -90 to 90. Updates the node |
| `longitude` | number | No | -180 to 180. Updates the node |

- Numbers must be JSON numbers, not strings (`27.4`, not `"27.4"`).
- Leave out a field, or send `null`, if the sensor has no value. A missing temperature or
  humidity never raises an alert.
- Other fields are ignored.

**Motion duration is required for motion alerts.** An alert is raised only when
`motion_detected` is `true` and `motion_duration_seconds` is at least the node's motion
window (10 s by default). If the duration is left out it counts as 0, so a reading with
`"motion_detected": true` and no duration never raises an alert.

## Responses

All responses are JSON.

| Status | Meaning | Body |
|---|---|---|
| 201 | Reading saved | `{ "reading_id": "<uuid>", "alert_ids": ["<uuid>"] }` (`alert_ids` lists alerts created by this reading, often empty) |
| 400 | Invalid body | `{ "error": "Invalid reading", "details": ["humidity must be between 0 and 100"] }` |
| 401 | Missing or wrong `x-device-key` | `{ "error": "Missing or invalid device key" }` |
| 404 | Unknown `node_identifier` | `{ "error": "Unknown node NIAH-NODE-09" }` |
| 405 | Not a POST | `{ "error": "Method not allowed, use POST" }` |
| 409 | Node is marked inactive | `{ "error": "Node NIAH-NODE-01 is inactive" }` |
| 500 | Server problem | `{ "error": "..." }` |

Don't resend after a 201, 400, 401, 404 or 409, because sending the same reading again
gives the same result (or saves it twice). A 500 or a network error can be retried.
