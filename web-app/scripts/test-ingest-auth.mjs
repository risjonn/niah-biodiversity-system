// #30 C4/C5: ingest-reading rejects bad keys and bad bodies.
// Nothing is stored: every case fails before the insert.
const url = process.env.INGEST_URL;
const realKey = process.env.DEVICE_INGEST_KEY;
if (!url || !realKey) {
  console.error("Run with --env-file pointing at iot-firmware/simulator/.env");
  process.exit(1);
}

const cases = [
  {
    name: "C4: no device key",
    key: null,
    body: { node_identifier: "SECURITY-TEST" },
    expect: 401,
  },
  {
    name: "C4: wrong device key",
    key: "wrong-key",
    body: { node_identifier: "SECURITY-TEST" },
    expect: 401,
  },
  {
    name: "C5: malformed body (text for numbers, out of range)",
    key: realKey,
    body: {
      node_identifier: "SECURITY-TEST",
      temperature: "hot",
      humidity: 500,
    },
    expect: 400,
  },
  { name: "C5: not JSON at all", key: realKey, raw: "not json", expect: 400 },
  {
    name: "C5: valid body, unknown node",
    key: realKey,
    body: { node_identifier: "SECURITY-TEST-NO-SUCH-NODE", temperature: 25 },
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
    body: c.raw ?? JSON.stringify(c.body),
  });
  const text = await res.text();
  const ok = res.status === c.expect;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name} -> ${res.status} (expected ${c.expect}) ${text}`,
  );
}
console.log(failed ? `\n${failed} failed` : "\nAll passed");
