// ingest-reading: receives sensor readings from the LoRa gateway and saves them.
//
// Deployed from the Supabase dashboard with JWT verification turned off, because the
// gateway has no user login. Instead every request must carry the shared device key in an
// x-device-key header. The Supabase secret key stays here on the server and must never be
// put on a field device.
//
// Secrets: DEVICE_INGEST_KEY (set it yourself). SUPABASE_URL and SUPABASE_SECRET_KEYS are
// injected by Supabase; SUPABASE_SERVICE_ROLE_KEY is the legacy fallback.
//
// Request and response format: see iot-firmware/simulator/README.md.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-key",
};

const MAX_FUTURE_MS = 5 * 60 * 1000;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// [min, max] for each optional number field.
const NUMBER_RANGES: Record<string, [number, number]> = {
  temperature: [-20, 60],
  humidity: [0, 100],
  motion_duration_seconds: [0, Infinity],
  battery_level: [0, 100],
  latitude: [-90, 90],
  longitude: [-180, 180],
};

type Reading = {
  node_identifier: string;
  recorded_at: string;
  motion_detected: boolean;
  temperature?: number;
  humidity?: number;
  motion_duration_seconds?: number;
  battery_level?: number;
  latitude?: number;
  longitude?: number;
};

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extraHeaders },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

// Compares fixed-length digests byte by byte without stopping early, so the time taken
// reveals neither how much of the key matched nor how long the real key is.
async function deviceKeyMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function getSecretKey(): string | undefined {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (typeof parsed?.default === "string") return parsed.default;
    } catch {
      // Fall back to the legacy key below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined;
}

function rangeMessage(field: string, [min, max]: [number, number]) {
  return max === Infinity ? `${field} must be 0 or more` : `${field} must be between ${min} and ${max}`;
}

// Returns every problem at once so the IoT team can fix them in one go.
function validate(body: unknown): { reading?: Reading; errors: string[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { errors: ["Body must be a JSON object"] };
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];

  const nodeIdentifier = input.node_identifier;
  if (typeof nodeIdentifier !== "string" || nodeIdentifier.trim() === "") {
    errors.push("node_identifier is required and must be a non-empty string");
  }

  let recordedAt = new Date().toISOString();
  if (input.recorded_at !== undefined && input.recorded_at !== null) {
    const value = input.recorded_at;
    const time = typeof value === "string" && ISO_DATE_TIME.test(value) ? Date.parse(value) : NaN;
    if (Number.isNaN(time)) {
      errors.push("recorded_at must be an ISO 8601 date-time with a timezone, e.g. 2026-10-15T08:30:00Z");
    } else if (time > Date.now() + MAX_FUTURE_MS) {
      errors.push("recorded_at cannot be more than 5 minutes in the future");
    } else {
      recordedAt = new Date(time).toISOString();
    }
  }

  let motionDetected = false;
  if (input.motion_detected !== undefined && input.motion_detected !== null) {
    if (typeof input.motion_detected === "boolean") {
      motionDetected = input.motion_detected;
    } else {
      errors.push("motion_detected must be true or false");
    }
  }

  const numbers: Partial<Reading> = {};
  for (const [field, range] of Object.entries(NUMBER_RANGES)) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field} must be a number`);
    } else if (value < range[0] || value > range[1]) {
      errors.push(rangeMessage(field, range));
    } else {
      (numbers as Record<string, number>)[field] = value;
    }
  }

  if (errors.length > 0) return { errors };

  return {
    errors,
    reading: {
      node_identifier: (nodeIdentifier as string).trim(),
      recorded_at: recordedAt,
      motion_detected: motionDetected,
      ...numbers,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed, use POST" }, { Allow: "POST, OPTIONS" });
  }

  const expectedKey = Deno.env.get("DEVICE_INGEST_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();
  if (!expectedKey || !supabaseUrl || !secretKey) {
    console.error("ingest-reading is missing DEVICE_INGEST_KEY, SUPABASE_URL or the secret key");
    return json(500, { error: "Server is not configured" });
  }

  const givenKey = req.headers.get("x-device-key");
  if (!givenKey || !(await deviceKeyMatches(givenKey, expectedKey))) {
    return json(401, { error: "Missing or invalid device key" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid reading", details: ["Body must be valid JSON"] });
  }

  const { reading, errors } = validate(body);
  if (!reading) {
    return json(400, { error: "Invalid reading", details: errors });
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: node, error: nodeError } = await supabase
    .from("sensor_nodes")
    .select("id, is_active")
    .eq("node_identifier", reading.node_identifier)
    .maybeSingle();

  if (nodeError) {
    console.error("Node lookup failed", nodeError);
    return json(500, { error: "Could not save the reading" });
  }
  if (!node) {
    return json(404, { error: `Unknown node ${reading.node_identifier}` });
  }
  if (!node.is_active) {
    return json(409, { error: `Node ${reading.node_identifier} is inactive` });
  }

  // The check_reading_thresholds trigger creates any alerts as part of this insert.
  const { data: saved, error: insertError } = await supabase
    .from("sensor_readings")
    .insert({
      sensor_node_id: node.id,
      recorded_at: reading.recorded_at,
      temperature: reading.temperature ?? null,
      humidity: reading.humidity ?? null,
      motion_detected: reading.motion_detected,
      motion_duration_seconds: reading.motion_duration_seconds ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Reading insert failed", insertError);
    return json(500, { error: "Could not save the reading" });
  }

  // The reading is saved from here on, so later failures are logged but still answer 201.
  // Answering with an error would make the gateway resend and store the reading twice.
  const nodeUpdate: Record<string, number> = {};
  for (const field of ["battery_level", "latitude", "longitude"] as const) {
    if (reading[field] !== undefined) nodeUpdate[field] = reading[field];
  }
  if (Object.keys(nodeUpdate).length > 0) {
    const { error: updateError } = await supabase.from("sensor_nodes").update(nodeUpdate).eq("id", node.id);
    if (updateError) console.error("Node update failed", updateError);
  }

  const { data: alerts, error: alertsError } = await supabase
    .from("alerts")
    .select("id")
    .eq("sensor_reading_id", saved.id);
  if (alertsError) console.error("Alert lookup failed", alertsError);

  return json(201, {
    reading_id: saved.id,
    alert_ids: (alerts ?? []).map((alert) => alert.id),
  });
});
