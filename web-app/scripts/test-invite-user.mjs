// Tests the deployed invite-user Edge Function against the project in web-app/.env. This
// creates real accounts, and the emails are printed at the end so they can be deleted.
//
// The test accounts all use the password in TEST_PASSWORD. The admin defaults to
// admin@test.com, set TEST_ADMIN_EMAIL to use another one.
//
// Usage, from web-app (PowerShell):
//   $env:TEST_PASSWORD = '<password>'; node scripts/test-invite-user.mjs

import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@test.com'
const OFFICER_EMAIL = 'conservation_officer@test.com'
const BOTANIST_EMAIL = 'botanists@test.com'

// Statuses where the function refused the request, so no account can have been created.
const REJECTED_STATUSES = [400, 401, 403, 405, 409]

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch (error) {
  console.error(`Could not read web-app/.env: ${error.message}`)
  process.exit(1)
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_PASSWORD } = process.env

if (!VITE_SUPABASE_URL || !VITE_SUPABASE_PUBLISHABLE_KEY) {
  console.error('web-app/.env must set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY')
  process.exit(1)
}
if (!TEST_PASSWORD) {
  console.error('Set the TEST_PASSWORD env var to the test accounts\' password')
  process.exit(1)
}

const timestamp = Date.now()
const createdEmails = new Set()
let failures = 0

function report(name, passed, detail) {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${passed || !detail ? '' : ` (${detail})`}`)
}

function newClient() {
  return createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Returns a signed-in client, or null after printing why the login failed.
async function logIn(email) {
  const client = newClient()
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) {
    console.log(`      Could not log in as ${email}: ${error.message}`)
    return null
  }
  return client
}

async function invite(client, body) {
  const { data, error } = await client.functions.invoke('invite-user', { body })

  // On a non-2xx answer, error.context is the Response. On a network failure it has no status.
  const status = error ? (error.context?.status ?? null) : 200
  const responseBody = error
    ? await error.context?.json?.().catch(() => null)
    : data

  // Anything but a clear refusal may have left an account behind, even on a case that should
  // have been rejected, so it has to end up in the list of emails to delete.
  if (!REJECTED_STATUSES.includes(status)) createdEmails.add(body.email)

  return { status, body: responseBody, message: error?.message }
}

// Never prints a whole response body, since a wrong 200 would contain a temp password.
async function expectRejected(name, client, body, expectedStatus, expectedError) {
  if (!client) {
    report(name, false, 'not logged in')
    return
  }
  const result = await invite(client, body)
  const errorText = result.body?.error
  const errorMatches = expectedError ? errorText === expectedError : typeof errorText === 'string'
  report(
    name,
    result.status === expectedStatus && errorMatches,
    `expected ${expectedStatus}, got ${result.status}: ${errorText ?? result.message ?? 'no error message'}`,
  )
}

function validInvite(label) {
  return {
    email: `invite-test-${timestamp}-${label}@test.com`,
    full_name: 'Invite Test',
    role: 'botanist',
  }
}

async function run() {
  await expectRejected('no login -> 401', newClient(), validInvite('no-login'), 401, 'Please log in again')

  const officer = await logIn(OFFICER_EMAIL)
  await expectRejected(
    'conservation_officer -> 403',
    officer,
    validInvite('officer'),
    403,
    'Only admins can add users',
  )

  const botanist = await logIn(BOTANIST_EMAIL)
  await expectRejected(
    'botanist -> 403',
    botanist,
    validInvite('botanist'),
    403,
    'Only admins can add users',
  )

  const admin = await logIn(ADMIN_EMAIL)
  await expectRejected('admin, invalid role -> 400', admin, { ...validInvite('bad-role'), role: 'superuser' }, 400)
  await expectRejected('admin, empty full_name -> 400', admin, { ...validInvite('no-name'), full_name: '   ' }, 400)
  await expectRejected('admin, bad email -> 400', admin, { ...validInvite('bad-email'), email: 'not-an-email' }, 400)

  const newUser = {
    email: `invite-test-${timestamp}@test.com`,
    full_name: 'Invite Test',
    role: 'botanist',
  }

  let created = null
  if (admin) {
    const result = await invite(admin, newUser)
    const user = result.body?.user
    report(
      'admin, valid new user -> 200',
      result.status === 200 &&
        Boolean(user?.id) &&
        user.email === newUser.email &&
        user.full_name === newUser.full_name &&
        user.role === newUser.role &&
        result.body.temp_password?.length === 12,
      `got ${result.status}: ${result.body?.error ?? result.message ?? 'unexpected response shape'}`,
    )
    if (result.status === 200 && user?.id) created = result.body
  } else {
    report('admin, valid new user -> 200', false, 'not logged in')
  }

  if (created) {
    const { data: profile, error } = await admin
      .from('profiles')
      .select('role')
      .eq('id', created.user.id)
      .maybeSingle()
    report(
      'profiles row exists with the right role',
      profile?.role === newUser.role,
      error?.message ?? `role is ${profile?.role ?? 'missing, no row found'}`,
    )
  } else {
    report('profiles row exists with the right role', false, 'the user was not created')
  }

  await expectRejected(
    'admin, same email again -> 409',
    admin,
    newUser,
    409,
    'An account with this email already exists',
  )

  if (created) {
    const { data, error } = await newClient().auth.signInWithPassword({
      email: newUser.email,
      password: created.temp_password,
    })
    report(
      'new user can sign in with temp_password',
      !error && data.user?.id === created.user.id,
      error?.message ?? 'signed in as a different user',
    )
  } else {
    report('new user can sign in with temp_password', false, 'the user was not created')
  }
}

try {
  await run()
} catch (error) {
  report('test run finished', false, error.message)
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`)

if (createdEmails.size > 0) {
  console.log('\nTest emails created, delete these in Supabase under Authentication > Users:')
  for (const email of createdEmails) console.log(`  ${email}`)
} else {
  console.log('\nNo test emails were created.')
}

process.exitCode = failures === 0 ? 0 : 1
