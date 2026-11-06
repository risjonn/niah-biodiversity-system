// #30 A6, C2, D1-D5. Uses the publishable key only, never a secret key.
// Upload tests are expected to be refused; anything that slips through is
// listed at the end so it can be deleted in the dashboard.
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
async function signedIn(email) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not log in as ${email}: ${error.message}`);
  return { c, session: data.session, id: data.user.id };
}

const results = [];
const leftovers = [];
const log = (id, result, detail) => {
  results.push({ id, result, detail });
  console.log(`${result.padEnd(4)}  ${id}: ${detail}`);
};
const bucket = "plant-photos";

const officer = await signedIn("conservation_officer@test.com");
const botanist = await signedIn("botanists@test.com");
const admin = await signedIn("admin@test.com");

// Find existing photo paths (officers can read all plants)
const { data: plants } = await officer.c
  .from("plants")
  .select("photo_url")
  .not("photo_url", "is", null)
  .limit(20);
const paths = (plants ?? []).map((p) => p.photo_url).filter(Boolean);

// D1: anonymous download
if (paths.length === 0) log("D1", "SKIP", "no photos in the database");
else {
  const { error } = await client().storage.from(bucket).download(paths[0]);
  log(
    "D1",
    error ? "PASS" : "FAIL",
    error ? `refused (${error.message})` : "anonymous download worked",
  );
}

// D2: botanist downloads from someone else's folder
const otherPath = paths.find((p) => p.split("/")[0] !== botanist.id);
if (!otherPath) log("D2", "SKIP", "no photo in another user's folder");
else {
  const { error } = await botanist.c.storage.from(bucket).download(otherPath);
  log(
    "D2",
    error ? "PASS" : "FAIL",
    error ? `refused (${error.message})` : "botanist read another user's photo",
  );
}

// D3: botanist uploads into the officer's folder
{
  const path = `${officer.id}/security-test.jpg`;
  const { error } = await botanist.c.storage
    .from(bucket)
    .upload(path, new Blob([new Uint8Array(10)], { type: "image/jpeg" }), {
      contentType: "image/jpeg",
    });
  if (!error) leftovers.push(path);
  log(
    "D3",
    error ? "PASS" : "FAIL",
    error ? `refused (${error.message})` : `upload worked: ${path}`,
  );
}

// D4a: text file into own folder
{
  const path = `${botanist.id}/security-test.txt`;
  const { error } = await botanist.c.storage
    .from(bucket)
    .upload(path, new Blob(["not an image"], { type: "text/plain" }), {
      contentType: "text/plain",
    });
  if (!error) leftovers.push(path);
  log(
    "D4a",
    error ? "PASS" : "FAIL",
    error ? `refused (${error.message})` : `text file accepted: ${path}`,
  );
}

// D4b: 6 MB "jpeg" into own folder (limit is 5 MB)
{
  const path = `${botanist.id}/security-test-big.jpg`;
  const { error } = await botanist.c.storage
    .from(bucket)
    .upload(
      path,
      new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }),
      { contentType: "image/jpeg" },
    );
  if (!error) leftovers.push(path);
  log(
    "D4b",
    error ? "PASS" : "FAIL",
    error ? `refused (${error.message})` : `6 MB file accepted: ${path}`,
  );
}

// D5: signed URL stops working after it expires
if (paths.length === 0) log("D5", "SKIP", "no photos in the database");
else {
  const { data } = await officer.c.storage
    .from(bucket)
    .createSignedUrl(paths[0], 2);
  const before = await fetch(data.signedUrl);
  await new Promise((r) => setTimeout(r, 5000));
  const after = await fetch(data.signedUrl);
  const ok = before.ok && !after.ok;
  log(
    "D5",
    ok ? "PASS" : "FAIL",
    `before expiry ${before.status}, after expiry ${after.status}`,
  );
}

// C2: invite-user with a tampered token
{
  const t = admin.session.access_token;
  const tampered = t.slice(0, -2) + (t.slice(-2) === "AA" ? "BB" : "AA");
  const res = await fetch(`${url}/functions/v1/invite-user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tampered}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "never-created@test.com",
      full_name: "X",
      role: "botanist",
    }),
  });
  log(
    "C2",
    res.status === 401 ? "PASS" : "FAIL",
    `tampered token -> ${res.status}`,
  );
}

// A6: old access token after sign-out (expected to keep working until it expires)
{
  const oldToken = admin.session.access_token;
  await admin.c.auth.signOut({ scope: "local" });
  const res = await fetch(`${url}/rest/v1/profiles?select=id`, {
    headers: { Authorization: `Bearer ${oldToken}`, apikey: key },
  });
  log(
    "A6",
    "INFO",
    `old token after sign-out -> ${res.status} (expires ${new Date(admin.session.expires_at * 1000).toISOString()})`,
  );
}

console.log(
  leftovers.length
    ? `\nDelete these in Storage > plant-photos:\n  ${leftovers.join("\n  ")}`
    : "\nNothing to clean up.",
);
