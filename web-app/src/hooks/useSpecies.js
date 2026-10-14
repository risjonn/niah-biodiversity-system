import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { containsAnyFilter, countResult, queryErrorMessage } from '../lib/queryHelpers'

// The species columns callers may set. id, created_by and the timestamps are managed here or by
// the database, so they are never taken from the caller.
const EDITABLE_FIELDS = [
  'scientific_name',
  'common_name',
  'family',
  'description',
  'conservation_status',
  'cultural_significance',
  'reference_photo_url',
]

const SEARCH_COLUMNS = ['scientific_name', 'common_name', 'family']

// Species database. Every function resolves to { data, error } and never throws: `error` is a
// message ready to show on screen (the same pattern as signIn in AuthContext).
// Reads are public. Writes are limited to conservation officers and admins by row-level security,
// so a refused write comes back as an error rather than being checked here first.
export function useSpecies() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const createSpecies = useCallback(
    async (fields) => {
      if (!userId) {
        return { data: null, error: 'You need to be signed in to add a species.' }
      }
      const values = pickEditableFields(fields)
      if (!values.scientific_name?.trim()) {
        return { data: null, error: 'A scientific name is required.' }
      }

      const { data, error } = await supabase
        .from('species')
        .insert({ ...values, created_by: userId })
        .select()
        .single()

      if (error) return { data: null, error: speciesErrorMessage(error) }
      return { data, error: null }
    },
    [userId],
  )

  return {
    fetchSpecies,
    getSpeciesById,
    countSpecies,
    createSpecies,
    updateSpecies,
    deleteSpecies,
  }
}

// How many species are in the database, without loading them
function countSpecies() {
  return countResult(supabase.from('species').select('*', { count: 'exact', head: true }))
}

// All species, alphabetical by scientific name. `search` matches scientific name, common name or
// family; `conservationStatus` is one of the conservation_status enum values.
async function fetchSpecies({ search, conservationStatus } = {}) {
  let query = supabase.from('species').select('*').order('scientific_name')

  const searchFilter = containsAnyFilter(SEARCH_COLUMNS, search)
  if (searchFilter) query = query.or(searchFilter)
  if (conservationStatus) query = query.eq('conservation_status', conservationStatus)

  const { data, error } = await query
  if (error) return { data: [], error: speciesErrorMessage(error) }
  return { data, error: null }
}

// Resolves to the species, or to data: null with no error when there is no species with that id.
// An id that isn't a UUID (a mistyped URL) can't match any row, so it is treated the same way
// instead of being sent to the database and coming back as a format error.
async function getSpeciesById(id) {
  if (!UUID_PATTERN.test(id ?? '')) return { data: null, error: null }

  const { data, error } = await supabase.from('species').select('*').eq('id', id).maybeSingle()

  if (error) return { data: null, error: speciesErrorMessage(error) }
  return { data, error: null }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Changes only the fields passed in `fields`; anything left out keeps its current value
async function updateSpecies(id, fields) {
  const values = pickEditableFields(fields)
  if (Object.keys(values).length === 0) {
    return { data: null, error: 'There are no changes to save.' }
  }
  if ('scientific_name' in values && !values.scientific_name?.trim()) {
    return { data: null, error: 'A scientific name is required.' }
  }

  // updated_at has no trigger keeping it current, so it is set here
  const { data, error } = await supabase
    .from('species')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return { data: null, error: speciesErrorMessage(error) }
  // Row-level security hides rows the user can't change instead of raising an error, so an
  // empty result is either a missing species or a refused write
  if (!data) return { data: null, error: NOT_CHANGED_MESSAGE }
  return { data, error: null }
}

// Resolves to the deleted species' id
async function deleteSpecies(id) {
  const { data, error } = await supabase
    .from('species')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { data: null, error: speciesErrorMessage(error) }
  if (!data) return { data: null, error: NOT_CHANGED_MESSAGE }
  return { data: data.id, error: null }
}

const NOT_CHANGED_MESSAGE =
  'That species could not be changed. It may have been deleted, or your account may not be allowed to edit species.'

function pickEditableFields(fields = {}) {
  return Object.fromEntries(
    EDITABLE_FIELDS.filter((field) => fields[field] !== undefined).map((field) => [
      field,
      fields[field],
    ]),
  )
}

function speciesErrorMessage(error) {
  switch (error.code) {
    case '42501':
      return 'Your account is not allowed to edit species.'
    // scientific_name is unique
    case '23505':
      return 'A species with that scientific name already exists.'
    // Plant records still point at the species being deleted
    case '23503':
      return 'This species has plant records linked to it, so it cannot be deleted.'
    default:
      return queryErrorMessage(error)
  }
}
