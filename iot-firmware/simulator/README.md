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
node simulate.js <node_identifier> [scenario] [--interval s] [--count n] [--battery level]
```

To send past readings for the dashboard charts, see [Backfilling history](#backfilling-history).
For `--battery`, see [Battery level](#battery-level).

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

## Battery level

The battery only ever goes down, in normal runs and backfills alike, and each node carries on
from where it was. It never jumps back up between readings or between runs.

The simulator only has the device key, which can't read `sensor_nodes`, so it can't look up a
node's current level. Instead:

- `--battery` sets the starting level. `--battery 92` is for every node in the command,
  `--battery NIAH-NODE-01=92` for one node; repeat it for each node. Use the level the web
  Sensors page shows (or `select node_identifier, battery_level from sensor_nodes;` in the SQL
  Editor).
- After each saved reading, the simulator writes the node's level to `.battery-state.json` in
  this folder (gitignored), and the next run carries on from there. So `--battery` is only
  needed once per node, or after the battery is "replaced".
- With no `--battery` and no saved level, `battery_level` is not sent at all, so the node keeps
  the level it already has. A message says so.

`--battery` wins over the saved level, even when it is higher (a message says so). The saved
levels belong to the machine that ran the simulator: if a teammate sends readings for the same
node from another machine, pass `--battery` again with the dashboard's level.

Normal runs drop the level by 0.01 to 0.05 % per reading. Backfills drop it by 0.3 to 0.8 % a
day, a different rate per node.

## Backfilling history

The sensor dashboard charts show the last 24 hours or 7 days. To give them something to show
before the hardware is running, send readings with past `recorded_at` times:

```
node simulate.js --backfill <duration> <node_identifier>... [--every <duration>] [--with-events] [--battery level]
```

```
node simulate.js --backfill 7d NIAH-NODE-01 NIAH-NODE-02
node simulate.js --backfill 24h NIAH-NODE-01 --every 5m
node simulate.js --backfill 14d NIAH-NODE-01 NIAH-NODE-02 --every 30m --with-events --battery NIAH-NODE-01=91 --battery NIAH-NODE-02=86
```

- `--backfill` is how far back to start: `m`, `h` or `d`, up to `30d`. Readings run from then
  up to now.
- `--every` is the gap between readings (default `15m`, at least `1m`). Each time is nudged by
  up to 30 seconds, like a real device.
- List every node to fill. The simulator only has the device key, which can't list nodes, so it
  can't find the active ones by itself. An inactive node (409) or unknown node (404) is skipped
  after its first reading and reported at the end.

The readings follow a daily cycle in Sarawak time: about 22 °C and 95 % humidity around 03:00,
about 30 °C and 75 % around 15:00, with small differences between nodes and days. A few have
short motion (1 to 8 s), more at night. Every value is inside the default limits, so a backfill
raises no alerts unless a node has tighter limits of its own, or `--with-events` is used.
`battery_level` starts from the node's level and drains slowly, see
[Battery level](#battery-level), so each node's battery ends on the newest value.

### Alerts in the history: `--with-events`

`--with-events` adds a few out-of-range readings spread over the period, so real alerts are
created by the database trigger through `ingest-reading`, just as the hardware would create them.
Per node:

| Event | When | Readings | Values | Alert with the default limits |
|---|---|---|---|---|
| Hot | About a quarter of the way in, around 14:00 Sarawak time | 2 in a row | 36.5–38.5 °C | `temperature_anomaly` |
| Dry | About halfway, around 13:00 | 2 in a row | 40–46 % humidity | `humidity_anomaly` |
| Long motion | About 80 % of the way, around 02:00 | 1 | Motion for 18–45 s | `motion_detected` (high) |

Each node after the first is shifted a little later, so the nodes' alerts land on different
days. The times of each node's events are printed at the start, and the summary compares the
alerts raised with the 3 expected. Fewer means the node has its own limits in
`alert_thresholds`, or already had an unacknowledged alert of that type (only one per type
per node is open at a time, so the second reading of a hot or dry event raises nothing).
It needs at least 12 readings per node.

Alerts get the time they were created, not the reading's time, so all of a backfill's alerts
show as created just now on the dashboard. Run `database/seed/012_align_alert_times.sql`
afterwards to move them to their readings' times (step 5 in `database/seed/README.md`).

Each node's readings are sent one at a time in time order, and nodes run side by side. 7 days
at the default 15 minutes is 673 readings per node and takes a few minutes. A 5xx or network
error is retried twice; any 4xx stops that node. Progress is printed every 10 %, and a summary
per node at the end. The exit code is 1 if any reading was not saved.

Run it once. Running it again adds a second set of readings over the same period.

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
