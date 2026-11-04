// invite-user: lets an admin create an account. There is no public sign-up, so this is the
// only way a new user gets in. Called by the web UserManagement page with
// supabase.functions.invoke('invite-user', { body: { email, full_name, role } }).
//
// 200 -> { user: { id, email, full_name, role }, temp_password }
// Errors -> { error: "<message ready to show in the UI>" }
//
// Checks the caller's token and role itself, so the messages below reach the UI and every
// response carries the CORS headers. JWT verification is turned off in supabase/config.toml,
// otherwise the Supabase gateway answers requests without a valid token before this code runs.
//
// SUPABASE_URL and SUPABASE_SECRET_KEYS are injected by Supabase; SUPABASE_SERVICE_ROLE_KEY
// is the legacy fallback. These keys must never appear in web-app or mobile-app.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLES = ["botanist", "conservation_officer", "admin"];

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_ERROR = "Could not add the user. Please try again.";

const TEMP_PASSWORD_LENGTH = 12;

// Letters and digits without the look-alikes 0/O/o and 1/I/l.
const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

type Invite = {
  email: string;
  full_name: string;
  role: string;
};

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extraHeaders },
  });
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

function bearerToken(req: Request): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function randomPassword(): string {
  // Bytes at or above this limit are skipped, because taking them modulo the number of
  // characters would make the first few characters more likely than the rest.
  const limit = 256 - (256 % TEMP_PASSWORD_CHARS.length);
  let password = "";
  while (password.length < TEMP_PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(TEMP_PASSWORD_LENGTH))) {
      if (byte < limit && password.length < TEMP_PASSWORD_LENGTH) {
        password += TEMP_PASSWORD_CHARS[byte % TEMP_PASSWORD_CHARS.length];
      }
    }
  }
  return password;
}

// Always contains all three kinds of character, so createUser can't reject it for one
// missing by chance if the project's password rules require them.
function generateTempPassword(): string {
  let password: string;
  do {
    password = randomPassword();
  } while (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password));
  return password;
}

function validate(body: unknown): { invite?: Invite; error?: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  const input = body as Record<string, unknown>;

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL_FORMAT.test(email)) {
    return { error: "Enter a valid email address" };
  }

  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : "";
  if (fullName === "") {
    return { error: "Enter the user's full name" };
  }

  const role = input.role;
  if (typeof role !== "string" || !ROLES.includes(role)) {
    return { error: "Role must be botanist, conservation officer or admin" };
  }

  return { invite: { email, full_name: fullName, role } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed, use POST" }, { Allow: "POST, OPTIONS" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) {
    console.error("invite-user is missing SUPABASE_URL or the secret key");
    return json(500, { error: GENERIC_ERROR });
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = bearerToken(req);
  if (!token) {
    return json(401, { error: "Please log in again" });
  }
  const { data: { user: caller }, error: callerError } = await supabase.auth.getUser(token);
  if (callerError || !caller) {
    return json(401, { error: "Please log in again" });
  }

  const { data: callerProfile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  if (profileError) {
    console.error("Caller profile lookup failed", profileError);
    return json(500, { error: GENERIC_ERROR });
  }
  if (callerProfile?.role !== "admin") {
    return json(403, { error: "Only admins can add users" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Request body must be valid JSON" });
  }

  const { invite, error: invalidMessage } = validate(body);
  if (!invite) {
    return json(400, { error: invalidMessage });
  }

  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: invite.email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createError) {
    if (createError.code === "email_exists" || createError.code === "user_already_exists") {
      return json(409, { error: "An account with this email already exists" });
    }
    console.error("User creation failed", createError);
    return json(500, { error: GENERIC_ERROR });
  }

  const userId = created.user.id;

  // No trigger creates profiles, and without a row the user has no role and can't log in.
  const { error: insertError } = await supabase.from("profiles").insert({
    id: userId,
    full_name: invite.full_name,
    email: invite.email,
    role: invite.role,
  });

  if (insertError) {
    console.error("Profile insert failed", insertError);
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(`Could not delete auth user ${userId}, it has no profile`, deleteError);
    }
    return json(500, { error: GENERIC_ERROR });
  }

  return json(200, {
    user: { id: userId, email: invite.email, full_name: invite.full_name, role: invite.role },
    temp_password: tempPassword,
  });
});
