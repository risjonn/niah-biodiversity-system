// Sends fake sensor readings to the ingest-reading Edge Function, standing in for the
// LoRa gateway. Node 24, no packages. See README.md for setup and the JSON format.
//
// Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n] [--battery level]
//                         [--extra] [--start lat,lng]
//        node simulate.js --backfill <duration> <node_identifier>... [--every <duration>]
//                         [--with-events] [--battery level] [--extra]

const fs = require('node:fs');
const path = require('node:path');

const USAGE =
  'Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n] [--battery level] [--extra] [--start lat,lng]\n' +
  '       node simulate.js --backfill <duration> <node_identifier>... [--every <duration>] [--with-events] [--battery level] [--extra]\n' +
  'Threshold scenarios: normal, hot, dry, motion, brief-motion (add --extra to also send the node fields)\n' +
  'Device scenarios: impact, poaching, night-poaching, critical-fall, stolen, tamper (always send the node fields)\n' +
  'stolen needs --start lat,lng, the node\'s position; it sends 6 packets unless --count is given\n' +
  'Durations: a whole number with m, h or d, e.g. 15m, 12h, 7d\n' +
  'Battery: a percentage for every node (--battery 92) or for one node (--battery NODE-01=92),\n' +
  '         repeat it for each node';

// Backfill limits. Past 30 days the readings would be older than anything the dashboard shows.
const MAX_BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_STEP_MS = 60 * 1000;
const DEFAULT_STEP = '15m';
// Retries for a 5xx or network error, which the endpoint says are safe to resend
const BACKFILL_RETRIES = 2;

// Each node's last battery level sent and saved, so the next run carries on from it. Gitignored:
// it belongs to this machine, and the simulator can't read the level from the database.
const BATTERY_STATE_FILE = path.join(__dirname, '.battery-state.json');

// Random number between min and max, rounded to one decimal place.
function between(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// Random number between min and max, not rounded
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// ---------- node fields (docs/iot/gateway-contract.md) ----------
// The fields the gateway adds once SEND_EXTRA_FIELDS is on. Values from docs/iot/node-logic-guide.md:
// a calibrated, upright box and plant read a few degrees of tilt; soil moisture is a percentage.

// A settled node: small tilts, normal soil, now and then rain (wetter soil while it rains)
function settledNodeFields() {
  const raining = Math.random() < 0.15;
  return {
    tilt_angle: between(1, 4),
    plant_tilt_angle: between(0.5, 3),
    soil_moisture: raining ? between(65, 85) : between(40, 60),
    is_raining: raining,
    tamper_detected: false,
    human_detected: false,
  };
}

// Dry ground, no rain: the node only raises impact and poaching alerts while it is dry
function dryNodeFields() {
  return { ...settledNodeFields(), soil_moisture: between(40, 55), is_raining: false };
}

const METRES_PER_DEGREE_LATITUDE = 111320;

// The point `metres` from `start` in the direction `bearing` (radians clockwise from north),
// rounded to 6 decimal places (about 0.1 m), like the NEO-6M fix the gateway sends
function offsetPosition(start, metres, bearing) {
  const lat = start.lat + (metres * Math.cos(bearing)) / METRES_PER_DEGREE_LATITUDE;
  const lng =
    start.lng + (metres * Math.sin(bearing)) / (METRES_PER_DEGREE_LATITUDE * Math.cos((start.lat * Math.PI) / 180));
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
}

// Stolen: the node latches PLANT_STOLEN_MOVING once the box is more than 15 m from home, then sends
// live GPS every 5 s. The first packet is 20 m out, and each one after it about 5 m further on.
const STOLEN_FIRST_METRES = 20;
const STOLEN_METRES_PER_PACKET = 5;
const STOLEN_DEFAULT_COUNT = 6;

// Each scenario's values(i, context), with i counting packets from 1. Threshold scenarios send only
// the basic fields, plus the node fields with extraCode (the INFO code the node would give that
// reading) when --extra is passed. Device scenarios always send the node fields and their code.
//
// Default thresholds (009): temperature 18 to 35 °C, humidity 50 to 100 %, motion window 10 s.
// Readings with an alert_status never raise motion_detected (018: the node decides about motion),
// so --extra on motion or brief-motion raises no alert, and the device scenarios raise only their
// device alert whatever the motion duration.
const SCENARIOS = {
  normal: {
    extraCode: 'NORMAL',
    values: () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: false, motion_duration_seconds: 0 }),
  },
  hot: {
    extraCode: 'NORMAL',
    values: () => ({ temperature: between(37, 40), humidity: between(70, 90), motion_detected: false, motion_duration_seconds: 0 }),
  },
  dry: {
    extraCode: 'NORMAL',
    values: () => ({ temperature: between(24, 30), humidity: between(35, 45), motion_detected: false, motion_duration_seconds: 0 }),
  },
  motion: {
    // Under the node's 120 s loitering limit, so still only MOTION_ONLY
    extraCode: 'MOTION_ONLY',
    values: () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(15, 30) }),
  },
  'brief-motion': {
    extraCode: 'MOTION_ONLY',
    values: () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(2, 5) }),
  },

  // 3 strong knocks within 10 s on the box or plant. Only raised while dry. Motion duration 0 as in
  // the contract's example.
  impact: {
    device: true,
    values: () => ({
      temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: 0,
      ...dryNodeFields(), tilt_angle: between(2, 4), plant_tilt_angle: between(3, 8),
      alert_status: 'IMPACT_DETECTED',
    }),
  },
  // Daytime: the camera saw a person after motion and a plant tilt past the 12° day limit
  poaching: {
    device: true,
    values: () => ({
      temperature: between(26, 31), humidity: between(65, 80), motion_detected: true, motion_duration_seconds: between(5, 9),
      ...dryNodeFields(), tilt_angle: between(3, 6), plant_tilt_angle: between(12.5, 20), human_detected: true,
      alert_status: 'POACHING_RISK',
    }),
  },
  // The same at night, when the plant limit is 6° and it counts as CRITICAL
  'night-poaching': {
    device: true,
    values: () => ({
      temperature: between(22, 24), humidity: between(90, 96), motion_detected: true, motion_duration_seconds: between(5, 9),
      ...dryNodeFields(), tilt_angle: between(2, 5), plant_tilt_angle: between(6.5, 12), human_detected: true,
      alert_status: 'NIGHT_POACHING_RISK',
    }),
  },
  // Box tilted 75° or more, almost fallen
  'critical-fall': {
    device: true,
    values: () => ({
      temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(1, 4),
      ...settledNodeFields(), tilt_angle: between(76, 89), plant_tilt_angle: between(1, 5),
      alert_status: 'CRITICAL_FALL',
    }),
  },
  // Box carried away: tilted and moving, GPS further from home on every packet
  stolen: {
    device: true,
    values: (i, { start, bearing }) => ({
      temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(3, 5),
      ...settledNodeFields(), tilt_angle: between(20, 45), plant_tilt_angle: between(5, 20),
      ...offsetPosition(start, STOLEN_FIRST_METRES + STOLEN_METRES_PER_PACKET * (i - 1) + between(-0.5, 0.5), bearing + between(-0.03, 0.03)),
      alert_status: 'PLANT_STOLEN_MOVING',
    }),
  },
  // Enclosure lid opened
  tamper: {
    device: true,
    values: () => ({
      temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(2, 6),
      ...settledNodeFields(), tilt_angle: between(2, 6), tamper_detected: true,
      alert_status: 'TAMPER_LID_OPENED',
    }),
  },
};

// One live reading's fields for scenario, packet i
function scenarioFields(scenario, i, context, extra) {
  const { values, device, extraCode } = SCENARIOS[scenario];
  const fields = values(i, context);
  if (device || !extra) return fields;
  return { ...fields, ...settledNodeFields(), alert_status: extraCode };
}

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

// '15m', '12h' or '7d' in milliseconds, or NaN when it isn't one of those
function parseDuration(text) {
  const match = /^(\d+)(m|h|d)$/.exec(text ?? '');
  if (!match) return NaN;
  const unitMs = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2]];
  return Number(match[1]) * unitMs;
}

// '92' sets every node's starting level, 'NODE-01=92' one node's
function parseBattery(text, battery) {
  const match = /^(?:(.+)=)?(\d+(?:\.\d+)?)$/.exec(text ?? '');
  const level = match ? Number(match[2]) : NaN;
  if (!(level >= 0 && level <= 100)) {
    fail('--battery must be a percentage from 0 to 100, or <node_identifier>=<percent>, e.g. --battery NODE-01=92');
  }
  if (match[1]) battery.byNode.set(match[1], level);
  else battery.all = level;
}

// '3.8256,113.7645' as { lat, lng }
function parseStart(text) {
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text ?? '');
  const lat = match ? Number(match[1]) : NaN;
  const lng = match ? Number(match[2]) : NaN;
  if (!(lat >= -89 && lat <= 89 && lng >= -180 && lng <= 180)) {
    fail('--start must be <latitude>,<longitude> with no space, e.g. --start 3.8256,113.7645');
  }
  return { lat, lng };
}

function parseArgs(argv) {
  const positional = [];
  let interval = 5;
  let count = 1;
  let backfill = null;
  let every = null;
  let withEvents = false;
  let extra = false;
  let start = null;
  const battery = { all: null, byNode: new Map() };
  const seen = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) seen.add(arg);
    if (arg === '--backfill' || arg === '--every') {
      const text = argv[++i];
      const ms = parseDuration(text);
      if (arg === '--backfill') {
        if (!(ms > 0) || ms > MAX_BACKFILL_MS) fail('--backfill must be a duration from 1m to 30d, e.g. 7d');
        backfill = { text, ms };
      } else {
        if (!(ms >= MIN_STEP_MS)) fail('--every must be a duration of 1m or more, e.g. 15m');
        every = { text, ms };
      }
    } else if (arg === '--interval' || arg === '--count') {
      const value = Number(argv[++i]);
      if (arg === '--interval') {
        if (!(value > 0)) fail('--interval must be a number of seconds above 0');
        interval = value;
      } else {
        if (!Number.isInteger(value) || value < 1) fail('--count must be a whole number of 1 or more');
        count = value;
      }
    } else if (arg === '--battery') {
      parseBattery(argv[++i], battery);
    } else if (arg === '--with-events') {
      withEvents = true;
    } else if (arg === '--extra') {
      extra = true;
    } else if (arg === '--start') {
      start = parseStart(argv[++i]);
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  let options;
  if (backfill) {
    if (seen.has('--interval') || seen.has('--count')) {
      fail('--interval and --count are not used with --backfill; use --every for the gap between readings');
    }
    if (positional.length === 0) fail('Missing node_identifier');
    const scenario = positional.find((arg) => Object.hasOwn(SCENARIOS, arg));
    if (scenario) fail(`Scenarios are not used with --backfill (got ${scenario}); use --with-events for out-of-range readings`);
    if (start) fail('--start is only used with the stolen scenario');
    const step = every ?? { text: DEFAULT_STEP, ms: parseDuration(DEFAULT_STEP) };
    if (step.ms >= backfill.ms) fail('--every must be shorter than --backfill');
    if (withEvents && Math.floor(backfill.ms / step.ms) + 1 < MIN_EVENT_READINGS) {
      fail(`--with-events needs at least ${MIN_EVENT_READINGS} readings per node; use a longer --backfill or a shorter --every`);
    }
    options = { mode: 'backfill', nodeIdentifiers: [...new Set(positional)], backfill, step, withEvents, extra, battery };
  } else {
    if (every) fail('--every is only used with --backfill');
    if (withEvents) fail('--with-events is only used with --backfill; for one live alert use a scenario such as hot or impact');

    const [nodeIdentifier, scenario = 'normal', ...unexpected] = positional;
    if (!nodeIdentifier) fail('Missing node_identifier');
    if (unexpected.length > 0) fail(`Unexpected argument ${unexpected[0]}`);
    if (!Object.hasOwn(SCENARIOS, scenario)) fail(`Unknown scenario ${scenario}`);
    if (scenario === 'stolen') {
      // The track starts from where the node is installed, which the simulator can't look up (the
      // device key can't read sensor_nodes)
      if (!start) fail('stolen needs --start <latitude>,<longitude>, the node\'s position on the Sensors page');
      if (!seen.has('--count')) count = STOLEN_DEFAULT_COUNT;
    } else if (start) {
      fail('--start is only used with the stolen scenario');
    }
    options = { mode: 'live', nodeIdentifiers: [nodeIdentifier], scenario, interval, count, extra, start, battery };
  }

  for (const node of battery.byNode.keys()) {
    if (!options.nodeIdentifiers.includes(node)) fail(`--battery names ${node}, which isn't one of the nodes being sent`);
  }
  return options;
}

function loadEnv() {
  try {
    // Values already set in the shell win over .env.
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const { INGEST_URL, DEVICE_INGEST_KEY } = process.env;
  if (!INGEST_URL || !DEVICE_INGEST_KEY) {
    console.error('INGEST_URL and DEVICE_INGEST_KEY must be set. Copy .env.example to .env and fill them in.');
    process.exit(1);
  }
  return { url: INGEST_URL, deviceKey: DEVICE_INGEST_KEY };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;

// ---------- battery ----------
// The battery only ever goes down. Each node starts from --battery when given, otherwise from the
// level this simulator last saved for it. With neither, battery_level isn't sent at all, so the
// node keeps whatever level it has rather than jumping to a made-up one.
// Levels are kept unrounded and sent rounded to one decimal; rounding never pushes a lower level
// above a higher one, so the levels sent never go up either.

function loadBatteryState() {
  let text;
  try {
    text = fs.readFileSync(BATTERY_STATE_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    const state = JSON.parse(text);
    if (state && typeof state === 'object' && !Array.isArray(state)) return state;
  } catch {
    // Reported below
  }
  console.error(`${BATTERY_STATE_FILE} is not a JSON object. Delete it and pass --battery with each node's level.`);
  process.exit(1);
}

function createBatteries(nodeIdentifiers, battery) {
  const state = loadBatteryState();
  const startLevels = new Map();

  for (const node of nodeIdentifiers) {
    const given = battery.byNode.get(node) ?? battery.all;
    const saved = typeof state[node] === 'number' ? state[node] : null;
    const start = given ?? saved;

    if (start === null) {
      console.log(
        `${node}: no battery level saved yet, so battery_level isn't sent and the node keeps its current level. ` +
          `To start it draining, pass --battery ${node}=<percent> once, with the level the dashboard shows.`,
      );
    } else if (given !== null && saved !== null && given > saved) {
      console.log(`${node}: battery starts at ${given} % because of --battery, above the ${round1(saved)} % saved last time`);
    }
    startLevels.set(node, start);
  }

  return {
    // The level to start from, or null when battery_level isn't sent for this node
    start: (node) => startLevels.get(node),
    // After a reading carrying this level was saved
    remember(node, level) {
      state[node] = level;
      fs.writeFileSync(BATTERY_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    },
  };
}

// ---------- backfill ----------
// Readings with past recorded_at times, so the dashboard charts have history to show. The values
// follow a daily cycle (coolest and most humid around 03:00 Sarawak time, warmest and driest
// around 15:00), stay inside the default alert limits, and include short motion events, more of
// them at night. Each node gets its own offsets and a battery that drains slowly.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SARAWAK_OFFSET_HOURS = 8;

// --with-events: a few out-of-range readings spread through the period, so the threshold trigger
// (009) raises real alerts. `at` is how far through the period (0 to 1), `sarawakHour` the time of
// day that suits the event, `readings` how many in a row. With the default limits each node gets
// one temperature, one humidity and one motion alert: while an alert is unacknowledged, a second
// out-of-range reading of the same type raises nothing.
const EVENTS = [
  {
    type: 'hot',
    alertType: 'temperature_anomaly',
    at: 0.25,
    sarawakHour: 14,
    readings: 2,
    values: () => ({ temperature: between(36.5, 38.5), humidity: between(62, 70), motion_detected: false, motion_duration_seconds: 0 }),
  },
  {
    type: 'dry',
    alertType: 'humidity_anomaly',
    at: 0.5,
    sarawakHour: 13,
    readings: 2,
    values: () => ({ temperature: between(30, 33), humidity: between(40, 46), motion_detected: false, motion_duration_seconds: 0 }),
  },
  {
    type: 'long motion',
    alertType: 'motion_detected',
    at: 0.8,
    sarawakHour: 2,
    readings: 1,
    values: () => ({ temperature: between(22, 24), humidity: between(90, 96), motion_detected: true, motion_duration_seconds: between(18, 45) }),
  },
];
// Enough readings that the events can't crowd each other out
const MIN_EVENT_READINGS = 12;

function nodeProfile() {
  const dayDrift = new Map();
  return {
    temperatureOffset: between(-1, 1),
    humidityOffset: between(-4, 4),
    batteryDrainPerDay: randomBetween(0.3, 0.8),
    // Some days are a little warmer or cooler than others
    driftFor(day) {
      if (!dayDrift.has(day)) dayDrift.set(day, between(-1, 1));
      return dayDrift.get(day);
    },
  };
}

// The same Sarawak day as `time`, at `hour` o'clock Sarawak time
function sarawakHourOnSameDay(time, hour) {
  const offsetMs = SARAWAK_OFFSET_HOURS * HOUR_MS;
  const dayStart = Math.floor((time + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  return dayStart + hour * HOUR_MS;
}

function sarawakLabel(time) {
  return `${new Date(time + SARAWAK_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 16).replace('T', ' ')} (+08)`;
}

function nearestIndex(times, target) {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i] - target) < Math.abs(times[best] - target)) best = i;
  }
  return best;
}

// The first index, searching outwards from `index`, where `length` readings in a row are free
function freeRunNear(times, index, length, used) {
  for (let distance = 0; distance < times.length; distance++) {
    for (const start of [index - distance, index + distance]) {
      if (start < 0 || start + length > times.length) continue;
      let free = true;
      for (let i = start; i < start + length; i++) if (used.has(i)) free = false;
      if (free) return start;
    }
  }
  throw new Error('No room for the events; use a longer --backfill');
}

// Which reading indexes carry which event. Each node is shifted a little later than the one
// before, so the nodes' alerts don't all land on the same days.
function planEvents(times, nodeIndex) {
  const first = times[0];
  const last = times[times.length - 1];
  const byIndex = new Map();
  const placed = [];

  for (const event of EVENTS) {
    const fraction = Math.min(0.95, event.at + nodeIndex * 0.06);
    const target = first + fraction * (last - first);
    const atHour = sarawakHourOnSameDay(target, event.sarawakHour);
    const wanted = atHour >= first && atHour <= last ? atHour : target;
    const start = freeRunNear(times, nearestIndex(times, wanted), event.readings, byIndex);
    for (let i = start; i < start + event.readings; i++) byIndex.set(i, event);
    placed.push(`${event.type} at ${sarawakLabel(times[start])}`);
  }
  return { byIndex, placed };
}

function backfillReading(nodeIdentifier, time, startTime, profile, event, extra) {
  const sarawakHours = time / HOUR_MS + SARAWAK_OFFSET_HOURS;
  const hourOfDay = ((sarawakHours % 24) + 24) % 24;
  const day = Math.floor(sarawakHours / 24);
  // 1 at 15:00, -1 at 03:00
  const cycle = Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24);
  const isNight = hourOfDay >= 19 || hourOfDay < 6;
  const motion = Math.random() < (isNight ? 0.08 : 0.03);

  const reading = {
    node_identifier: nodeIdentifier,
    recorded_at: new Date(time).toISOString(),
    // Default limits (009) are 18 to 35 °C and 50 to 100 %, so these never raise an alert there
    temperature: round1(clamp(26 + profile.temperatureOffset + profile.driftFor(day) + 3.5 * cycle + between(-0.5, 0.5), 19, 34)),
    humidity: round1(clamp(84 + profile.humidityOffset - 10 * cycle + between(-3, 3), 55, 99)),
    motion_detected: motion,
    // Shorter than the default 10 s motion window, so no motion alerts either
    motion_duration_seconds: motion ? between(1, 8) : 0,
  };
  const withEvent = event ? { ...reading, ...event.values() } : reading;
  if (!extra) return withEvent;
  // --extra: the node fields too, with the INFO code the node would give (never an alert)
  return { ...withEvent, ...settledNodeFields(), alert_status: withEvent.motion_detected ? 'MOTION_ONLY' : 'NORMAL' };
}

// Evenly spaced times from `durationMs` ago up to now, each nudged by up to a quarter of the gap
// (at most 30 s) like a real device's timing. Oldest first, and always in order: the nudge is
// less than half the gap.
function backfillTimes(durationMs, stepMs, now) {
  const jitter = Math.min(30 * 1000, stepMs / 4);
  const times = [];
  for (let time = now - durationMs; time <= now; time += stepMs) {
    times.push(Math.min(now, Math.round(time + between(-jitter, jitter))));
  }
  return times;
}

// Sends one reading, retrying a 5xx or network error. Resolves to { status, body } or { error }.
async function postReading(url, deviceKey, reading) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-key': deviceKey },
        body: JSON.stringify(reading),
      });
      const body = await response.text();
      if (response.status < 500 || attempt >= BACKFILL_RETRIES) return { status: response.status, body };
    } catch (err) {
      if (attempt >= BACKFILL_RETRIES) return { error: err.message };
    }
    await sleep(1000 * (attempt + 1));
  }
}

// One node's readings in time order, so the node's battery level ends on the newest one. Stops
// at the first 4xx answer: it would be the same for every reading (wrong key, unknown or inactive
// node, invalid reading).
async function backfillNode(nodeIdentifier, nodeIndex, times, { url, deviceKey }, batteries, withEvents, extra) {
  const profile = nodeProfile();
  const startLevel = batteries.start(nodeIdentifier);
  const events = withEvents ? planEvents(times, nodeIndex) : null;
  const summary = { nodeIdentifier, saved: 0, failed: 0, alerts: 0, stoppedBy: null, events, startLevel, endLevel: null };
  const reportEvery = Math.max(1, Math.round(times.length / 10));

  if (events) console.log(`${nodeIdentifier} events: ${events.placed.join(', ')}`);

  for (let i = 0; i < times.length; i++) {
    const reading = backfillReading(nodeIdentifier, times[i], times[0], profile, events?.byIndex.get(i), extra);
    // Drains with time from the starting level, never below 0
    const level =
      startLevel === null ? null : Math.max(0, startLevel - (profile.batteryDrainPerDay * (times[i] - times[0])) / DAY_MS);
    if (level !== null) reading.battery_level = round1(level);

    const result = await postReading(url, deviceKey, reading);

    if (result.status === 201) {
      summary.saved += 1;
      if (level !== null) {
        batteries.remember(nodeIdentifier, level);
        summary.endLevel = level;
      }
      try {
        summary.alerts += JSON.parse(result.body).alert_ids?.length ?? 0;
      } catch {
        // A 201 without the usual body still saved the reading
      }
    } else if (result.status >= 400 && result.status < 500) {
      summary.failed += times.length - i;
      summary.stoppedBy = `${result.status} ${result.body}`;
      break;
    } else {
      summary.failed += 1;
      console.error(`${nodeIdentifier}: reading at ${reading.recorded_at} failed: ${result.error ?? `${result.status} ${result.body}`}`);
    }

    if ((i + 1) % reportEvery === 0 || i + 1 === times.length) {
      console.log(`${nodeIdentifier}: ${i + 1}/${times.length} sent`);
    }
  }
  return summary;
}

async function runBackfill({ nodeIdentifiers, backfill, step, withEvents, extra, battery }, env) {
  const batteries = createBatteries(nodeIdentifiers, battery);
  const now = Date.now();
  const timesByNode = nodeIdentifiers.map(() => backfillTimes(backfill.ms, step.ms, now));
  const perNode = timesByNode[0].length;

  console.log(
    `Backfilling ${backfill.text} of readings, one every ${step.text}, for ${nodeIdentifiers.join(', ')} ` +
      `to ${env.url}\nAbout ${perNode} readings per node, ${perNode * nodeIdentifiers.length} in all.` +
      `${withEvents ? ` With events: ${EVENTS.map((e) => e.type).join(', ')} once per node.` : ''}\n`,
  );

  // Nodes run side by side; each node's readings go one at a time
  const summaries = await Promise.all(
    nodeIdentifiers.map((nodeIdentifier, index) =>
      backfillNode(nodeIdentifier, index, timesByNode[index], env, batteries, withEvents, extra),
    ),
  );

  // With --extra every reading has an alert_status, and the database then leaves motion to the
  // node (018): the long motion event is sent as MOTION_ONLY and raises nothing
  const alertingEvents = EVENTS.filter((e) => !(extra && e.alertType === 'motion_detected'));

  console.log('');
  for (const s of summaries) {
    const stopped = s.stoppedBy ? `, stopped by ${s.stoppedBy}` : '';
    const expected = s.events ? ` (${alertingEvents.length} expected from the events)` : '';
    const batteryText =
      s.startLevel === null
        ? ', battery not sent'
        : `, battery ${round1(s.startLevel)} % -> ${s.endLevel === null ? 'unchanged' : `${round1(s.endLevel)} %`}`;
    console.log(`${s.nodeIdentifier}: ${s.saved} saved, ${s.failed} not saved, ${s.alerts} alert(s) raised${expected}${batteryText}${stopped}`);
    if (s.failed > 0) process.exitCode = 1;
    if (s.events && !s.stoppedBy && s.alerts < alertingEvents.length) {
      console.log(
        `  Fewer alerts than events: the node may have its own limits in alert_thresholds, or an ` +
          `unacknowledged alert of the same type was already open (${alertingEvents.map((e) => e.alertType).join(', ')}).`,
      );
    }
  }
}

// ---------- live ----------

async function runLive({ nodeIdentifiers, scenario, interval, count, extra, start, battery }, { url, deviceKey }) {
  const [nodeIdentifier] = nodeIdentifiers;
  const batteries = createBatteries(nodeIdentifiers, battery);
  let level = batteries.start(nodeIdentifier);
  // stolen: one direction for the whole run
  const context = { start, bearing: Math.random() * 2 * Math.PI };

  const withFields = SCENARIOS[scenario].device || extra ? ', with the node fields' : '';
  console.log(`Sending ${count} "${scenario}" reading(s)${withFields} for ${nodeIdentifier} to ${url}\n`);
  if (scenario === 'stolen') {
    console.log(
      `GPS track starts 20 m from ${start.lat}, ${start.lng}. Each fix is saved on its reading; ` +
        `${nodeIdentifier}'s installed position doesn't change.\n`,
    );
  }

  for (let i = 1; i <= count; i++) {
    const reading = {
      node_identifier: nodeIdentifier,
      recorded_at: new Date().toISOString(),
      ...scenarioFields(scenario, i, context, extra),
    };
    // A small drop per reading
    if (level !== null) {
      level = Math.max(0, level - randomBetween(0.01, 0.05));
      reading.battery_level = round1(level);
    }

    console.log(`[${i}/${count}] Sent ${JSON.stringify(reading)}`);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-key': deviceKey },
        body: JSON.stringify(reading),
      });
      const body = await response.text();
      console.log(`[${i}/${count}] ${response.status} ${response.statusText} ${body}\n`);
      if (response.status === 201 && level !== null) batteries.remember(nodeIdentifier, level);
      if (!response.ok) process.exitCode = 1;
    } catch (err) {
      console.error(`[${i}/${count}] Request failed: ${err.message}\n`);
      process.exitCode = 1;
    }

    if (i < count) await sleep(interval * 1000);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  if (options.mode === 'backfill') await runBackfill(options, env);
  else await runLive(options, env);
}

main();
