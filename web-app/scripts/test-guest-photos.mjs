// #45 guest access to plant photos (database/schema/017_multiple_photos.sql). Uses the publishable
// key only, never a secret key, and changes nothing. Prints statuses and counts only: no keys,
// URLs, storage paths or IDs.
//
// The officer finds one photo of a pending plant, one of an approved unmonitored plant and one of
// a monitored plant (if there is one). A separate client with no session (a guest) then tries to
// sign a URL for each: only the approved unmonitored one may work. Last, the guest's view of
// plant_photos must be exactly the photos of approved unmonitored plants.
//
// Run from web-app: TEST_PASSWORD=... node --env-file=.env scripts/test-guest-photos.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const password = process.env.TEST_PASSWORD;
if (!url || !key || !password) {
  console.error("Run from web-app with --env-file=.env and TEST_PASSWORD set");
  process.exit(1);
}

const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const results = [];
const log = (id, result, detail) => {
  results.push({ id, result, detail });
  console.log(`${result.padEnd(4)}  ${id}: ${detail}`);
};
const bucket = "plant-photos";
const PAGE_SIZE = 1000;

// Every row of a query, a page at a time (the API returns at most 1000 rows per request)
async function allRows(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: null, error };
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { rows, error: null };
  }
}

const isPublic = (plant) =>
  plant.review_status === "approved" && !plant.is_monitored;

// ---------- officer: every photo with its plant's status ----------
const officer = client();
{
  const { error } = await officer.auth.signInWithPassword({
    email: "conservation_officer@test.com",
    password,
  });
  if (error) {
    console.error(`Could not log in as the officer (${error.message})`);
    process.exit(1);
  }
}

const { rows: photos, error: photosError } = await allRows(() =>
  officer
    .from("plant_photos")
    .select("storage_path, plants!inner(review_status, is_monitored)")
    .order("id"),
);
if (photosError) {
  // Most likely 017 isn't applied yet (no plant_photos table)
  console.error(`Officer could not read plant_photos (${photosError.message})`);
  process.exit(1);
}
console.log(`Officer can see ${photos.length} plant photo(s)\n`);

const pick = (test) => photos.find((p) => test(p.plants))?.storage_path;
const samples = [
  {
    id: "G1",
    label: "an approved, unmonitored plant",
    path: pick(isPublic),
    allowed: true,
  },
  {
    id: "G2",
    label: "a pending plant",
    path: pick((p) => p.review_status === "pending_review"),
    allowed: false,
  },
  {
    id: "G3",
    label: "a monitored plant",
    path: pick((p) => p.review_status === "approved" && p.is_monitored),
    allowed: false,
  },
];

// ---------- guest: signed URLs ----------
// A new client that never signs in, so every request goes out as anon
const guest = client();

for (const s of samples) {
  if (!s.path) {
    log(s.id, "SKIP", `no photo of ${s.label} in the database`);
    continue;
  }
  const { data, error } = await guest.storage
    .from(bucket)
    .createSignedUrl(s.path, 60);

  if (!s.allowed) {
    log(
      s.id,
      error ? "PASS" : "FAIL",
      error
        ? `guest refused a signed URL for ${s.label} (${error.status ?? error.statusCode ?? "no status"} ${error.message})`
        : `guest got a signed URL for ${s.label}`,
    );
    continue;
  }

  if (error) {
    log(
      s.id,
      "FAIL",
      `guest could not sign a URL for ${s.label} (${error.status ?? error.statusCode ?? "no status"} ${error.message})`,
    );
    continue;
  }
  // The URL must also open, not just be created. Only the status is printed.
  const res = await fetch(data.signedUrl);
  await res.body?.cancel();
  log(
    s.id,
    res.ok ? "PASS" : "FAIL",
    `guest signed a URL for ${s.label}, which opens with HTTP ${res.status}`,
  );
}

// ---------- guest: which plant_photos rows are visible ----------
// Only the columns 017 grants to anon
{
  const { rows: seen, error } = await allRows(() =>
    guest
      .from("plant_photos")
      .select("plant_id, storage_path, position")
      .order("storage_path"),
  );
  if (error) {
    log("G4", "FAIL", `guest could not read plant_photos (${error.message})`);
  } else {
    const statusByPath = new Map(photos.map((p) => [p.storage_path, p.plants]));
    const expected = photos.filter((p) => isPublic(p.plants)).length;
    const seenPaths = new Set(seen.map((r) => r.storage_path));
    const notAllowed = { pending: 0, rejected: 0, monitored: 0, unknown: 0 };
    for (const row of seen) {
      const plant = statusByPath.get(row.storage_path);
      if (!plant) notAllowed.unknown++;
      else if (plant.review_status === "pending_review") notAllowed.pending++;
      else if (plant.review_status === "rejected") notAllowed.rejected++;
      else if (plant.is_monitored) notAllowed.monitored++;
    }
    const extra = Object.values(notAllowed).reduce((a, b) => a + b, 0);
    const missing = photos.filter(
      (p) => isPublic(p.plants) && !seenPaths.has(p.storage_path),
    ).length;
    const ok = extra === 0 && missing === 0;
    log(
      "G4",
      ok ? "PASS" : "FAIL",
      `guest sees ${seen.length} row(s), expected ${expected}; ` +
        `${missing} missing, not allowed: ${notAllowed.pending} pending, ` +
        `${notAllowed.rejected} rejected, ${notAllowed.monitored} monitored, ` +
        `${notAllowed.unknown} unknown to the officer`,
    );
  }
}

await officer.auth.signOut({ scope: "local" });

const failed = results.filter((r) => r.result === "FAIL").length;
const skipped = results.filter((r) => r.result === "SKIP").length;
console.log(
  `\n${failed ? `${failed} failed` : "No failures"}` +
    (skipped ? `, ${skipped} skipped (no matching photo to test)` : ""),
);
if (failed) process.exitCode = 1;
