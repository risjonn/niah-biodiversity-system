import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Plant records for the signed-in user. Both functions resolve to { data, error } and never throw:
// `error` is a message ready to show on screen, so callers only track their own loading state
// (the same split as signIn in AuthContext and LoginScreen).
export function usePlants() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Saves a new plant and returns the inserted row, including the qr_code the database generates
  async function submitPlant({
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

    // Only these fields are sent: review status, recorded_at and qr_code are left to the
    // database defaults and triggers, and recorded_by is always the signed-in user
    const { data, error } = await supabase
      .from('plants')
      .insert({
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

    if (error) return { data: null, error: plantErrorMessage(error) }
    return { data, error: null }
  }

  // The signed-in user's own submissions, newest first, whatever their review status
  async function fetchMyPlants() {
    if (!userId) {
      return { data: [], error: 'You need to be signed in to see your plant records.' }
    }

    const { data, error } = await supabase
      .from('plants')
      .select('*')
      .eq('recorded_by', userId)
      .order('recorded_at', { ascending: false })

    if (error) return { data: [], error: plantErrorMessage(error) }
    return { data, error: null }
  }

  return { submitPlant, fetchMyPlants }
}

function plantErrorMessage(error) {
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
