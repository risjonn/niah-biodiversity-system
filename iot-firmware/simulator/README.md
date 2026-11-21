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
`NODE-01` and `NODE-02`, the names the gateway uses (`docs/iot/gateway-contract.md`). Older
databases called them `NIAH-NODE-01` and `NIAH-NODE-02`; migration 018 renames them.

## Running

```
node simulate.js <node_identifier> [scenario] [--interval s] [--count n] [--battery level] [--extra] [--start lat,lng]
```

To send past readings for the dashboard charts, see [Backfilling history](#backfilling-history).
For `--battery`, see [Battery level](#battery-level).

### Threshold scenarios

These send the basic fields the gateway sends today, and raise alerts through the database's
thresholds (009).

| Scenario | What it sends | Expected with the default thresholds |
|---|---|---|
| `normal` (default) | 24–30 °C, 70–90 % humidity, no motion | No alert |
| `hot` | 37–40 °C | `temperature_anomaly` alert |
| `dry` | 35–45 % humidity | `humidity_anomaly` alert |
| `motion` | Motion lasting 15–30 s | `motion_detected` alert |
| `brief-motion` | Motion lasting 2–5 s | No alert (shorter than the 10 s window) |

`--extra` adds the node fields as well, the way the gateway will once `SEND_EXTRA_FIELDS` is on:
settled tilts (box 1–4°, plant 0.5–3°), soil moisture 40–60 % (65–85 % while raining), rain now
and then, no tamper, no person, and the INFO code the node would give: `NORMAL`, or
`MOTION_ONLY` for `motion` and `brief-motion`. INFO codes never raise a device alert. `hot` and
`dry` raise the same alerts as without `--extra`, but **`motion --extra` raises none**: once a
reading has an `alert_status`, the database leaves motion to the node's own logic (018) and
skips the `motion_detected` time limit. Temperature and humidity limits still apply.

### Device scenarios

These are the Forest Node's own alerts (`alert_status`, migration 018). They always send the node
fields. Each raises one `device_alert` with that code; WARNING codes are `medium` severity and
CRITICAL codes `high`. They never raise `motion_detected` as well, however long the motion: with
an `alert_status`, the node decides about motion.

| Scenario | What it sends | `alert_status` | Severity |
|---|---|---|---|
| `impact` | Motion, small tilts, dry | `IMPACT_DETECTED` | WARNING (`medium`) |
| `poaching` | Motion, plant tilt 12.5–20° (past the 12° day limit), a person seen, dry | `POACHING_RISK` | WARNING (`medium`) |
| `night-poaching` | Cooler and humid, plant tilt 6.5–12° (past the 6° night limit), a person seen, dry | `NIGHT_POACHING_RISK` | CRITICAL (`high`) |
| `critical-fall` | Box tilt 76–89° | `CRITICAL_FALL` | CRITICAL (`high`) |
| `stolen` | Box tilt 20–45°, motion, GPS moving away from `--start` | `PLANT_STOLEN_MOVING` | CRITICAL (`high`) |
| `tamper` | `tamper_detected: true` | `TAMPER_LID_OPENED` | CRITICAL (`high`) |

`poaching` and `night-poaching` don't look at the clock: the scenario decides the code.

**`stolen` needs `--start <latitude>,<longitude>`**, the node's position as the Sensors page shows
it (or `select node_identifier, latitude, longitude from sensor_nodes;`). The first packet is 20 m
from there, just past the node's 15 m theft limit, and each packet after it about 5 m further on in
one direction, every 5 s (the node's live GPS rate). It sends 6 packets unless `--count` is given.
Only the first raises an alert; the rest find it still open. Each GPS fix is saved on its
reading (`sensor_readings.latitude` and `longitude`); the node's own position stays where it was
installed, so nothing needs putting back afterwards.

`--interval` is the number of seconds between readings (default 5). `--count` is the number
of readings to send (default 1, or 6 for `stolen`).

```
node simulate.js NODE-01 hot
node simulate.js NODE-02 normal --count 10 --interval 2
node simulate.js NODE-01 normal --extra
node simulate.js NODE-01 impact
node simulate.js NODE-01 stolen --start 3.8256,113.7645 --count 8
```

Each reading and the response status and body are printed. The exit code is 1 if any
request failed.

A node gets at most one unacknowledged alert of each type, and of each device code. Sending
`hot` (or `impact`) twice creates one alert, and the second response has an empty `alert_ids`.
Acknowledge the alert to get a new one. A device alert and a threshold alert don't block each
other, and two different codes on one node each get their own alert.

Default thresholds are placeholders: temperature 18 to 35 °C, humidity 50 to 100 %, motion
window 10 seconds. Nodes can have their own limits in `alert_thresholds`. Which codes raise an
alert, and at what severity, is in the `device_alert_codes` table (018), not in the simulator.

## Battery level

The real node and gateway don't send `battery_level` at all (contract section 3). The simulator
only sends it when you have given a level with `--battery`, now or in an earlier run (below).

The battery only ever goes down, in normal runs and backfills alike, and each node carries on
from where it was. It never jumps back up between readings or between runs.

The simulator only has the device key, which can't read `sensor_nodes`, so it can't look up a
node's current level. Instead:

- `--battery` sets the starting level. `--battery 92` is for every node in the command,
  `--battery NODE-01=92` for one node; repeat it for each node. Use the level the web
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
node simulate.js --backfill <duration> <node_identifier>... [--every <duration>] [--with-events] [--battery level] [--extra]
```

`--extra` gives every backfilled reading the node fields too, with `NORMAL` (or `MOTION_ONLY` when
there is motion), as in [Threshold scenarios](#threshold-scenarios). It raises no device alerts,
and with `--with-events` the long motion event raises nothing either (it is sent as
`MOTION_ONLY`), so the summary expects 2 alerts per node instead of 3.

```
node simulate.js --backfill 7d NODE-01 NODE-02
node simulate.js --backfill 24h NODE-01 --every 5m
node simulate.js --backfill 14d NODE-01 NODE-02 --every 30m --with-events --battery NODE-01=91 --battery NODE-02=86
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
alerts raised with the 3 expected (2 with `--extra`). Fewer means the node has its own limits in
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
  "node_identifier": "NODE-01",
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
| `latitude` | number | No | -90 to 90. The box's GPS fix, saved on the reading. Send both or neither |
| `longitude` | number | No | -180 to 180. Saved on the reading with `latitude` |
| `tilt_angle` | number | No | Box tilt, degrees, 0 to 180 |
| `plant_tilt_angle` | number | No | Plant tilt, degrees, 0 to 180 |
| `soil_moisture` | number | No | %, 0 to 100 |
| `is_raining` | boolean | No | |
| `tamper_detected` | boolean | No | |
| `human_detected` | boolean | No | From the camera (YOLO) |
| `alert_status` | string | No | One of the 16 codes in `docs/iot/gateway-contract.md` section 2, exactly as written there (`"NORMAL"`, not `"normal"`). WARNING and CRITICAL codes raise a device alert |

`latitude`, `longitude` and the fields from `tilt_angle` down need migration 018 (they are saved
on the reading). The gateway sends them once `SEND_EXTRA_FIELDS` is on; until then it sends only
the basic fields, which keep working as before. GPS no longer moves the node: `sensor_nodes`
keeps the position it was installed at, which is what the Sensors page shows. With the extra
fields, the contract's example reading B:

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
  "alert_status": "POACHING_RISK"
}
```

That one raises one alert, `POACHING_RISK`. The 12 s of motion is over the 10 s motion window,
but a reading with an `alert_status` gets no `motion_detected` alert: the node has decided.

- Numbers must be JSON numbers, not strings (`27.4`, not `"27.4"`).
- Leave out a field, or send `null`, if the sensor has no value. A missing temperature or
  humidity never raises an alert.
- Other fields are ignored.

**Motion duration is required for motion alerts.** A `motion_detected` alert is raised only
when the reading has no `alert_status`, `motion_detected` is `true` and
`motion_duration_seconds` is at least the node's motion window (10 s by default). If the
duration is left out it counts as 0, so a reading with `"motion_detected": true` and no
duration never raises an alert.

## Responses

All responses are JSON.

| Status | Meaning | Body |
|---|---|---|
| 201 | Reading saved | `{ "reading_id": "<uuid>", "alert_ids": ["<uuid>"] }` (`alert_ids` lists alerts created by this reading, often empty) |
| 400 | Invalid body | `{ "error": "Invalid reading", "details": ["humidity must be between 0 and 100"] }`. An unknown `alert_status` lists the allowed codes: `"alert_status \"BAD\" is not a known code. Allowed: CRITICAL_FALL, FIRE_OR_CANOPY_BREACH, ..."` |
| 401 | Missing or wrong `x-device-key` | `{ "error": "Missing or invalid device key" }` |
| 404 | Unknown `node_identifier` | `{ "error": "Unknown node NODE-09" }` |
| 405 | Not a POST | `{ "error": "Method not allowed, use POST" }` |
| 409 | Node is marked inactive | `{ "error": "Node NODE-01 is inactive" }` |
| 500 | Server problem | `{ "error": "..." }` |

Don't resend after a 201, 400, 401, 404 or 409, because sending the same reading again
gives the same result (or saves it twice). A 500 or a network error can be retried.
