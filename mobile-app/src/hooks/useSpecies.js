import { supabase } from '../lib/supabaseClient'

// Species list for pickers. Read-only here: species are managed on the web dashboard. Resolves to
// { data, error } and never throws, with `error` as a message ready to show on screen (the same
// pattern as usePlants).
export function useSpecies() {
  return { fetchSpecies }
}

// Every species, alphabetical by scientific name. Species are public, so this works for any
// signed-in user.
async function fetchSpecies() {
  const { data, error } = await supabase
    .from('species')
    .select('id, scientific_name, common_name')
    .order('scientific_name')

  if (error) return { data: [], error: speciesErrorMessage(error) }
  return { data, error: null }
}

function speciesErrorMessage(error) {
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Unable to reach the server. Check your connection and try again.'
    default:
      return error.message
  }
}
