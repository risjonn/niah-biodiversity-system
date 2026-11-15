// Sends fake sensor readings to the ingest-reading Edge Function, standing in for the
// LoRa gateway. Node 24, no packages. See README.md for setup and the JSON format.
//
// Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n]
//        node simulate.js --backfill <duration> <node_identifier>... [--every <duration>]

const path = require('node:path');

const USAGE =
  'Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n]\n' +
  '       node simulate.js --backfill <duration> <node_identifier>... [--every <duration>]\n' +
  'Scenarios: normal, hot, dry, motion, brief-motion\n' +
  'Durations: a whole number with m, h or d, e.g. 15m, 12h, 7d';

// Backfill limits. Past 30 days the readings would be older than anything the dashboard shows.
const MAX_BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_STEP_MS = 60 * 1000;
const DEFAULT_STEP = '15m';
// Retries for a 5xx or network error, which the endpoint says are safe to resend
const BACKFILL_RETRIES = 2;

// Random number between min and max, rounded to one decimal place.
function between(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// Default thresholds (009): temperature 18 to 35 °C, humidity 50 to 100 %, motion window 10 s.
const SCENARIOS = {
  normal: () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: false, motion_duration_seconds: 0 }),
  hot: () => ({ temperature: between(37, 40), humidity: between(70, 90), motion_detected: false, motion_duration_seconds: 0 }),
  dry: () => ({ temperature: between(24, 30), humidity: between(35, 45), motion_detected: false, motion_duration_seconds: 0 }),
  motion: () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(15, 30) }),
  'brief-motion': () => ({ temperature: between(24, 30), humidity: between(70, 90), motion_detected: true, motion_duration_seconds: between(2, 5) }),
};

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

function parseArgs(argv) {
  const positional = [];
  let interval = 5;
  let count = 1;
  let backfill = null;
  let every = null;
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
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (backfill) {
    if (seen.has('--interval') || seen.has('--count')) {
      fail('--interval and --count are not used with --backfill; use --every for the gap between readings');
    }
    if (positional.length === 0) fail('Missing node_identifier');
    const scenario = positional.find((arg) => SCENARIOS[arg]);
    if (scenario) fail(`Scenarios are not used with --backfill (got ${scenario}); it always sends normal readings`);
    const step = every ?? { text: DEFAULT_STEP, ms: parseDuration(DEFAULT_STEP) };
    if (step.ms >= backfill.ms) fail('--every must be shorter than --backfill');
    return { mode: 'backfill', nodeIdentifiers: [...new Set(positional)], backfill, step };
  }
  if (every) fail('--every is only used with --backfill');

  const [nodeIdentifier, scenario = 'normal', ...extra] = positional;
  if (!nodeIdentifier) fail('Missing node_identifier');
  if (extra.length > 0) fail(`Unexpected argument ${extra[0]}`);
  if (!SCENARIOS[scenario]) fail(`Unknown scenario ${scenario}`);

  return { mode: 'live', nodeIdentifier, scenario, interval, count };
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

// ---------- backfill ----------
// Readings with past recorded_at times, so the dashboard charts have history to show. The values
// follow a daily cycle (coolest and most humid around 03:00 Sarawak time, warmest and driest
// around 15:00), stay inside the default alert limits, and include short motion events, more of
// them at night. Each node gets its own offsets and a battery that drains slowly.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SARAWAK_OFFSET_HOURS = 8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;

function nodeProfile() {
  const dayDrift = new Map();
  return {
    temperatureOffset: between(-1, 1),
    humidityOffset: between(-4, 4),
    batteryStart: between(70, 100),
    batteryDrainPerDay: between(1, 3),
    // Some days are a little warmer or cooler than others
    driftFor(day) {
      if (!dayDrift.has(day)) dayDrift.set(day, between(-1, 1));
      return dayDrift.get(day);
    },
  };
}

function backfillReading(nodeIdentifier, time, startTime, profile) {
  const sarawakHours = time / HOUR_MS + SARAWAK_OFFSET_HOURS;
  const hourOfDay = ((sarawakHours % 24) + 24) % 24;
  const day = Math.floor(sarawakHours / 24);
  // 1 at 15:00, -1 at 03:00
  const cycle = Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24);
  const isNight = hourOfDay >= 19 || hourOfDay < 6;
  const motion = Math.random() < (isNight ? 0.08 : 0.03);
  const elapsedDays = (time - startTime) / DAY_MS;

  return {
    node_identifier: nodeIdentifier,
    recorded_at: new Date(time).toISOString(),
    // Default limits (009) are 18 to 35 °C and 50 to 100 %, so these never raise an alert there
    temperature: round1(clamp(26 + profile.temperatureOffset + profile.driftFor(day) + 3.5 * cycle + between(-0.5, 0.5), 19, 34)),
    humidity: round1(clamp(84 + profile.humidityOffset - 10 * cycle + between(-3, 3), 55, 99)),
    motion_detected: motion,
    // Shorter than the default 10 s motion window, so no motion alerts either
    motion_duration_seconds: motion ? between(1, 8) : 0,
    battery_level: round1(clamp(profile.batteryStart - profile.batteryDrainPerDay * elapsedDays, 5, 100)),
  };
}

// Evenly spaced times from `durationMs` ago up to now, each nudged by up to a quarter of the gap
// (at most 30 s) like a real device's timing. Oldest first.
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
async function backfillNode(nodeIdentifier, times, url, deviceKey) {
  const profile = nodeProfile();
  const summary = { nodeIdentifier, saved: 0, failed: 0, alerts: 0, stoppedBy: null };
  const reportEvery = Math.max(1, Math.round(times.length / 10));

  for (let i = 0; i < times.length; i++) {
    const reading = backfillReading(nodeIdentifier, times[i], times[0], profile);
    const result = await postReading(url, deviceKey, reading);

    if (result.status === 201) {
      summary.saved += 1;
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

async function runBackfill({ nodeIdentifiers, backfill, step }, { url, deviceKey }) {
  const now = Date.now();
  const timesByNode = nodeIdentifiers.map(() => backfillTimes(backfill.ms, step.ms, now));
  const perNode = timesByNode[0].length;

  console.log(
    `Backfilling ${backfill.text} of readings, one every ${step.text}, for ${nodeIdentifiers.join(', ')} ` +
      `to ${url}\nAbout ${perNode} readings per node, ${perNode * nodeIdentifiers.length} in all.\n`,
  );

  // Nodes run side by side; each node's readings go one at a time
  const summaries = await Promise.all(
    nodeIdentifiers.map((nodeIdentifier, index) => backfillNode(nodeIdentifier, timesByNode[index], url, deviceKey)),
  );

  console.log('');
  for (const s of summaries) {
    const stopped = s.stoppedBy ? `, stopped by ${s.stoppedBy}` : '';
    console.log(`${s.nodeIdentifier}: ${s.saved} saved, ${s.failed} not saved, ${s.alerts} alert(s) raised${stopped}`);
    if (s.failed > 0) process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  if (options.mode === 'backfill') {
    await runBackfill(options, env);
    return;
  }

  const { nodeIdentifier, scenario, interval, count } = options;
  const { url, deviceKey } = env;

  console.log(`Sending ${count} "${scenario}" reading(s) for ${nodeIdentifier} to ${url}\n`);

  for (let i = 1; i <= count; i++) {
    const reading = {
      node_identifier: nodeIdentifier,
      recorded_at: new Date().toISOString(),
      ...SCENARIOS[scenario](),
      battery_level: between(90, 100),
    };

    console.log(`[${i}/${count}] Sent ${JSON.stringify(reading)}`);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-key': deviceKey },
        body: JSON.stringify(reading),
      });
      const body = await response.text();
      console.log(`[${i}/${count}] ${response.status} ${response.statusText} ${body}\n`);
      if (!response.ok) process.exitCode = 1;
    } catch (err) {
      console.error(`[${i}/${count}] Request failed: ${err.message}\n`);
      process.exitCode = 1;
    }

    if (i < count) await sleep(interval * 1000);
  }
}

main();
