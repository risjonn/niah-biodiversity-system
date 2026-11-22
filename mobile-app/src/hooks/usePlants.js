import { useAuth } from '../context/AuthContext'
import { requestOnline } from '../lib/network'
import { readSavedPlants, savePlants } from '../lib/plantCache'
import { isStaffRole } from '../lib/roles'
import { supabase } from '../lib/supabaseClient'

// Plant records for the signed-in user. Every function resolves to { data, error } and never
// throws: `error` is a message ready to show on screen, so callers only track their own loading
// state (the same split as signIn in AuthContext and LoginScreen). Failures also carry the raw
// PostgREST `code` ('' when the request never reached the database) and HTTP `status`, for
// callers such as the sync queue that need to tell a lost connection from a refused record.
export function usePlants() {
  const { user, role } = useAuth()
  const userId = user?.id ?? null

  // Saves a new plant and returns the inserted row, including the qr_code the database generates.
  // `id` and `recorded_at` are optional: the offline queue passes the id it generated and the
  // time the plant was recorded, otherwise the database defaults fill them in. If a plant with
  // that id is already saved, the error has `alreadySaved: true`.
  async function submitPlant({
    id,
    recorded_at,
    species_id,
    height_cm,
    morphological_notes,
    photo_url,
    latitude,
    longitude,
    location_description,
  }) {
    if (!userId) {
      return { data: null, error: 'You need to be signed in to submit a plant record.' }
    }
    if (!species_id || latitude == null || longitude == null) {
      return { data: null, error: 'A species and location are required.' }
    }

    // Only these fields are sent: review status and qr_code are left to the database defaults and
    // triggers, and recorded_by is always the signed-in user
    const { data, error } = await supabase
      .from('plants')
      .insert({
        ...(id ? { id } : {}),
        ...(recorded_at ? { recorded_at } : {}),
        species_id,
        height_cm,
        morphological_notes,
        photo_url,
        latitude,
        longitude,
        location_description,
        recorded_by: userId,
      })
      .select()
      .single()

    if (error) return { data: null, ...plantError(error) }
    return { data, error: null }
  }

  // One of the signed-in user's own plants, or null as data if there is no such plant
  async function fetchPlant(id) {
    if (!userId) {
      return { data: null, error: 'You need to be signed in to see your plant records.' }
    }

    const { data, error } = await supabase
      .from('plants')
      .select('*')
      .eq('id', id)
      .eq('recorded_by', userId)
      .maybeSingle()

    if (error) return { data: null, ...plantError(error) }
    return { data, error: null }
  }

  // A plant the signed-in user may open in Record detail, or null as data if there is none.
  // Conservation officers and admins can read every plant whatever its status or recorder
  // (plants_select_officer_admin, 001), so for them any plant; for botanists only their own, the
  // same as fetchPlant.
  async function fetchViewablePlant(id) {
    if (!isStaffRole(role)) return fetchPlant(id)

    const { data, error } = await supabase.from('plants').select('*').eq('id', id).maybeSingle()
    if (error) return { data: null, ...plantError(error) }
    return { data, error: null }
  }

  // The signed-in user's own submissions, newest first, whatever their review status. `offline` is
  // true when the server couldn't be reached (no connection, or no answer within
  // LOAD_TIMEOUT_MS): `data` is then the list loaded earlier this session or saved on the phone,
  // with `savedAt` the ISO time it was loaded, or [] with an error when there is neither.
  async function fetchMyPlants() {
    if (!userId) {
      return { data: [], error: 'You need to be signed in to see your plant records.', offline: false }
    }

    const response = await requestOnline(() =>
      supabase
        .from('plants')
        .select('*')
        .eq('recorded_by', userId)
        .order('recorded_at', { ascending: false }),
    )

    if (response && !response.error) {
      const savedAt = new Date().toISOString()
      lastLoadedMyPlants = { userId, plants: response.data, savedAt }
      savePlants(userId, response.data, savedAt)
      return { data: response.data, error: null, offline: false }
    }
    // Refused by the server (not a lost connection): nothing saved stands in for that
    if (response?.error.code) return { data: [], ...plantError(response.error), offline: false }

    const saved =
      lastLoadedMyPlants?.userId === userId ? lastLoadedMyPlants : await readSavedPlants(userId)
    if (saved) return { data: saved.plants, error: null, offline: true, savedAt: saved.savedAt }
    return { data: [], error: OFFLINE_MESSAGE, code: '', offline: true }
  }

  // The signed-in user's records from the last fetchMyPlants this session (Home and Records load
  // them), or null if they haven't loaded yet. No request: for screens that can show extra detail
  // from records already on the phone but shouldn't load them just for that.
  function getLoadedMyPlants() {
    return userId && lastLoadedMyPlants?.userId === userId ? lastLoadedMyPlants.plants : null
  }

  return { submitPlant, fetchPlant, fetchViewablePlant, fetchMyPlants, getLoadedMyPlants }
}

// Kept with the user it belongs to, so it never shows one user's records to the next
let lastLoadedMyPlants = null

const OFFLINE_MESSAGE = 'Unable to reach the server. Check your connection and try again.'

function plantError(error) {
  const alreadySaved = error.code === '23505' && /plants_pkey/.test(error.message ?? '')
  return {
    error: plantErrorMessage(error, alreadySaved),
    code: error.code ?? '',
    status: error.status,
    ...(alreadySaved ? { alreadySaved } : {}),
  }
}

function plantErrorMessage(error, alreadySaved) {
  if (alreadySaved) return 'This plant record has already been saved.'
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Unable to reach the server. Check your connection and try again.'
    // Row-level security refused the insert
    case '42501':
      return 'Your account is not allowed to submit plant records.'
    // species_id doesn't match a species
    case '23503':
      return 'That species could not be found. Choose a species from the list and try again.'
    // A NOT NULL column was left empty
    case '23502': {
      const column = error.message.match(/column "(\w+)"/)?.[1]
      return column ? `Missing a required value: ${column}.` : 'A required value is missing.'
    }
    // Malformed value, e.g. species_id that isn't a UUID
    case '22P02':
      return 'One of the values is not in the right format.'
    default:
      return error.message
  }
}
