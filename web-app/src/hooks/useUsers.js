import { supabase } from '../lib/supabaseClient'

// Matches the user_role enum in database/schema/001_initial_schema.sql
export const userRoles = ['botanist', 'conservation_officer', 'admin']

export const userRoleLabels = {
  botanist: 'Botanist',
  conservation_officer: 'Conservation officer',
  admin: 'Admin',
}

const COLUMNS = 'id, full_name, email, role, created_at'

async function fetchUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select(COLUMNS)
    .order('created_at', { ascending: true })
  return { data: data ?? null, error: error?.message ?? null }
}

// How many users there are, without loading them
async function countUsers() {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
  return { data: count, error: error?.message ?? null }
}

// Invites a new user through the invite-user Edge Function (it checks the caller is an admin).
// On success data is { user, tempPassword }, for the admin to pass on.
async function createUser({ fullName, email, role }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, full_name: fullName, role },
  })

  if (error) return { data: null, error: await functionErrorMessage(error) }
  if (data?.error) return { data: null, error: data.error }
  return { data: { user: data.user, tempPassword: data.temp_password }, error: null }
}

async function updateUserRole(userId, role) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select(COLUMNS)
    .maybeSingle()

  if (error) return { data: null, error: error.message } // e.g. "Only admins can change roles"
  // A blocked update (RLS) returns no row and no error
  if (!data) return { data: null, error: 'Role not changed. The user may not exist, or you may not have permission.' }
  return { data, error: null }
}

// A non-2xx response from the function arrives as an error whose body holds { error }
async function functionErrorMessage(error) {
  try {
    const body = await error.context?.json()
    if (body?.error) return body.error
  } catch {
    // body wasn't JSON, fall through
  }
  return error.message
}

const api = { fetchUsers, countUsers, createUser, updateUserRole }

// Module-level functions, so the object never changes between renders (safe in effect deps)
export function useUsers() {
  return api
}