// #43 I1: ingest-reading accepts the gateway's extra fields (docs/iot/gateway-contract.md) and
// refuses bad ones. Needs database/schema/018_device_alerts.sql applied and the new function
// deployed. One request per case; only statuses are printed, never the key or the bodies.
//
// The 400 cases use a node that doesn't exist, so if one wrongly passed validation it would get
// 404 instead of storing a reading. The two 201 cases store one reading each on TEST_NODE
// (default NODE-01, which must exist and be active). Both are NORMAL readings inside the default
// limits, so they raise no alert.
//
// Run from web-app: node --env-file=../iot-firmware/simulator/.env scripts/test-ingest-device.mjs
const url = process.env.INGEST_URL;
const realKey = process.env.DEVICE_INGEST_KEY;
if (!url || !realKey) {
  console.error("Run with --env-file pointing at iot-firmware/simulator/.env");
  process.exit(1);
}
const node = process.env.TEST_NODE || "NODE-01";
const noSuchNode = "DEVICE-TEST-NO-SUCH-NODE";

// The contract's reading B, with NORMAL so no alert is raised
const extraFields = {
  tamper_detected: false,
  tilt_angle: 4.2,
  plant_tilt_angle: 1.8,
  soil_moisture: 45,
  is_raining: false,
  human_detected: false,
  alert_status: "NORMAL",
};
const basic = { temperature: 26, humidity: 80, motion_detected: false, motion_duration_seconds: 0 };

const cases = [
  {
    name: "basic reading, no extra fields (gateway today, SEND_EXTRA_FIELDS = false)",
    key: realKey,
    body: { node_identifier: node, ...basic },
    expect: 201,
  },
  {
    name: "all extra fields with alert_status NORMAL",
    key: realKey,
    body: { node_identifier: node, ...basic, ...extraFields },
    expect: 201,
  },
  {
    name: "no device key, with extra fields",
    key: null,
    body: { node_identifier: noSuchNode, ...extraFields },
    expect: 401,
  },
  {
    name: "unknown alert_status, answer lists the allowed codes",
    key: realKey,
    body: { node_identifier: noSuchNode, alert_status: "NOT_A_CODE" },
    expect: 400,
    // Checked without printing the body
    check: (body) => body.details?.some((d) => d.includes("Allowed:") && d.includes("CRITICAL_FALL")),
  },
  {
    name: "lower-case alert_status (codes are exact)",
    key: realKey,
    body: { node_identifier: noSuchNode, alert_status: "normal" },
    expect: 400,
  },
  {
    name: "alert_status that isn't a string",
    key: realKey,
    body: { node_identifier: noSuchNode, alert_status: 3 },
    expect: 400,
  },
  {
    name: "tilt_angle above 180",
    key: realKey,
    body: { node_identifier: noSuchNode, tilt_angle: 181 },
    expect: 400,
  },
  {
    name: "tilt_angle below 0",
    key: realKey,
    body: { node_identifier: noSuchNode, tilt_angle: -1 },
    expect: 400,
  },
  {
    name: "plant_tilt_angle as text",
    key: realKey,
    body: { node_identifier: noSuchNode, plant_tilt_angle: "4.2" },
    expect: 400,
  },
  {
    name: "soil_moisture above 100",
    key: realKey,
    body: { node_identifier: noSuchNode, soil_moisture: 101 },
    expect: 400,
  },
  {
    name: "is_raining as text",
    key: realKey,
    body: { node_identifier: noSuchNode, is_raining: "no" },
    expect: 400,
  },
  {
    name: "tamper_detected as a number",
    key: realKey,
    body: { node_identifier: noSuchNode, tamper_detected: 1 },
    expect: 400,
  },
  {
    name: "human_detected as text",
    key: realKey,
    body: { node_identifier: noSuchNode, human_detected: "true" },
    expect: 400,
  },
  {
    name: "latitude without longitude",
    key: realKey,
    body: { node_identifier: noSuchNode, latitude: 3.812345 },
    expect: 400,
  },
  {
    name: "longitude without latitude",
    key: realKey,
    body: { node_identifier: noSuchNode, longitude: 113.776543 },
    expect: 400,
  },
  {
    name: "latitude above 90",
    key: realKey,
    body: { node_identifier: noSuchNode, latitude: 90.5, longitude: 113.7 },
    expect: 400,
  },
  {
    name: "valid GPS and extra fields, unknown node",
    key: realKey,
    body: { node_identifier: noSuchNode, ...extraFields, latitude: 3.812345, longitude: 113.776543 },
    expect: 404,
  },
  {
    name: "valid extra fields, unknown node",
    key: realKey,
    body: { node_identifier: noSuchNode, ...extraFields },
    expect: 404,
  },
];

let failed = 0;
for (const c of cases) {
  const headers = { "Content-Type": "application/json" };
  if (c.key) headers["x-device-key"] = c.key;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(c.body),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: the status still says what happened
  }
  const ok = res.status === c.expect && (!c.check || (body !== null && c.check(body)));
  if (!ok) failed++;
  const checkNote = c.check && res.status === c.expect && !ok ? ", body not as expected" : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} -> ${res.status} (expected ${c.expect}${checkNote})`);
}
console.log(failed ? `\n${failed} failed` : "\nAll passed");
if (failed) process.exitCode = 1;
