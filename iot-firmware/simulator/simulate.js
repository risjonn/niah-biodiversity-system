// Sends fake sensor readings to the ingest-reading Edge Function, standing in for the
// LoRa gateway. Node 24, no packages. See README.md for setup and the JSON format.
//
// Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n]

const path = require('node:path');

const USAGE =
  'Usage: node simulate.js <node_identifier> [scenario] [--interval s] [--count n]\n' +
  'Scenarios: normal, hot, dry, motion, brief-motion';

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

function parseArgs(argv) {
  const positional = [];
  let interval = 5;
  let count = 1;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--interval' || arg === '--count') {
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

  const [nodeIdentifier, scenario = 'normal', ...extra] = positional;
  if (!nodeIdentifier) fail('Missing node_identifier');
  if (extra.length > 0) fail(`Unexpected argument ${extra[0]}`);
  if (!SCENARIOS[scenario]) fail(`Unknown scenario ${scenario}`);

  return { nodeIdentifier, scenario, interval, count };
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

async function main() {
  const { nodeIdentifier, scenario, interval, count } = parseArgs(process.argv.slice(2));
  const { url, deviceKey } = loadEnv();

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
