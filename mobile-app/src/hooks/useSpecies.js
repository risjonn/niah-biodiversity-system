import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabaseClient'

// The last species list that loaded, so botanists can still register plants offline and guests
// can still look up scanned plants
const CACHE_KEY = 'niah-species-cache'

// Species list for pickers and guest plant lookups. Read-only here: species are managed on the web dashboard. Resolves to
// { data, error, savedAt } and never throws, with `error` as a message ready to show on screen
// (the same pattern as usePlants). `savedAt` is set when the server couldn't be reached and the
// list saved on the phone was used instead: the ISO time that list was downloaded.
export function useSpecies() {
  return { fetchSpecies, fetchSpeciesPhotos }
}

// A species' photo URLs, cover first (species_photos, database/schema/017). Public, so this works
// signed in or as a guest. Resolves to { data: [url], error }; not saved on the phone, so offline
// it fails and callers show the cover from the species list instead.
async function fetchSpeciesPhotos(speciesId) {
  const { data, error } = await supabase
    .from('species_photos')
    .select('photo_url, position')
    .eq('species_id', speciesId)
    .order('position')

  if (error) return { data: [], error: speciesErrorMessage(error) }
  return { data: data.map((row) => row.photo_url), error: null }
}

// Every species, alphabetical by scientific name, with the details guest mode shows. Species are
// public, so this works signed in or as a guest.
async function fetchSpecies() {
  const { data, error } = await supabase
    .from('species')
    .select(
      'id, scientific_name, common_name, family, description, conservation_status, cultural_significance, reference_photo_url',
    )
    .order('scientific_name')

  if (!error) {
    await saveSpecies(data)
    return { data, error: null, savedAt: null }
  }

  const saved = await readSavedSpecies()
  if (saved) return { data: saved.species, error: null, savedAt: saved.savedAt }
  return { data: [], error: speciesErrorMessage(error), savedAt: null }
}

async function saveSpecies(species) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), species }),
    )
  } catch {
    // The fresh list is still returned; the previously saved one stays as the fallback
  }
}

async function readSavedSpecies() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(CACHE_KEY))
    return Array.isArray(saved?.species) && saved.savedAt ? saved : null
  } catch {
    return null
  }
}

function speciesErrorMessage(error) {
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Connect to the internet once to download the species list.'
    default:
      return error.message
  }
}
