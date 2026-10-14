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

// Public bucket from database/schema/007_species_management.sql, which enforces the same type and
// size limits. They are checked here first so the form can say what is wrong before uploading.
const PHOTO_BUCKET = 'species-photos'
const PHOTO_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
// Every public URL for a file in the bucket contains this, followed by the file's path
const PUBLIC_PHOTO_URL_MARKER = `/storage/v1/object/public/${PHOTO_BUCKET}/`

// Species database and reference photos. Every function resolves to { data, error } and never
// throws: `error` is a message ready to show on screen (the same pattern as signIn in AuthContext).
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
      const invalid = requiredFieldError(values, { isNew: true })
      if (invalid) return { data: null, error: invalid }

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
    speciesPhotoError,
    uploadSpeciesPhoto,
    removeSpeciesPhoto,
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
  const invalid = requiredFieldError(values, { isNew: false })
  if (invalid) return { data: null, error: invalid }

  // updated_at is set by the set_updated_at trigger (007_species_management.sql)
  const { data, error } = await supabase
    .from('species')
    .update(values)
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

// The message for a chosen photo that can't be used, or null when it can be uploaded
function speciesPhotoError(file) {
  if (!PHOTO_EXTENSIONS[file?.type]) return 'Choose a JPEG or PNG photo.'
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 5 MB or smaller.'
  return null
}

// Uploads a reference photo under a new random name and resolves to its public URL, ready to save
// as reference_photo_url
async function uploadSpeciesPhoto(file) {
  const invalid = speciesPhotoError(file)
  if (invalid) return { data: null, error: invalid }

  const path = `${crypto.randomUUID()}.${PHOTO_EXTENSIONS[file.type]}`
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) return { data: null, error: photoUploadErrorMessage(error) }
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return { data: data.publicUrl, error: null }
}

// Clean-up after a photo is replaced, removed or left unused. Only files in the species-photos
// bucket are removed; any other URL (a species may point at an outside image) is left alone.
// A failure only leaves an unused file behind, so it is logged and never shown or allowed to
// block what the user was doing: this always resolves to { data: removed, error: null }.
async function removeSpeciesPhoto(url) {
  const path = speciesPhotoPath(url)
  if (!path) return { data: false, error: null }

  try {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).remove([path])
    if (error) throw error
    // Storage answers with an empty list rather than an error when it removed nothing, either
    // because the file is already gone or because the policies didn't allow it
    if (data.length === 0) {
      console.warn(`Species photo was not removed, it may be missing or not permitted: ${path}`)
      return { data: false, error: null }
    }
    return { data: true, error: null }
  } catch (error) {
    console.warn(`Species photo could not be removed: ${path}`, error)
    return { data: false, error: null }
  }
}

// The file's path inside the bucket, or null when the URL isn't a species-photos public URL
function speciesPhotoPath(url) {
  const index = typeof url === 'string' ? url.indexOf(PUBLIC_PHOTO_URL_MARKER) : -1
  if (index === -1) return null

  const encodedPath = url.slice(index + PUBLIC_PHOTO_URL_MARKER.length).split(/[?#]/)[0]
  try {
    return decodeURIComponent(encodedPath) || null
  } catch {
    return null
  }
}

const HAS_RECORDS_MESSAGE =
  'This species has plant records linked to it, so it cannot be deleted.'

const NOT_CHANGED_MESSAGE =
  'That species could not be changed. It may have been deleted, or your account may not be allowed to edit species.'

// Only the fields passed in, with text trimmed and empty text saved as null
function pickEditableFields(fields = {}) {
  return Object.fromEntries(
    EDITABLE_FIELDS.filter((field) => fields[field] !== undefined).map((field) => {
      const value = typeof fields[field] === 'string' ? fields[field].trim() : fields[field]
      return [field, value === '' ? null : value]
    }),
  )
}

// A new species needs both required fields; an edit only needs the ones it changes to be set
function requiredFieldError(values, { isNew }) {
  if ((isNew || 'scientific_name' in values) && !values.scientific_name) {
    return 'A scientific name is required.'
  }
  if ((isNew || 'conservation_status' in values) && !values.conservation_status) {
    return 'Choose a conservation status.'
  }
  return null
}

function speciesErrorMessage(error) {
  switch (error.code) {
    case '42501':
      return 'Your account is not allowed to edit species.'
    // scientific_name is unique
    case '23505':
      return 'A species with this scientific name already exists.'
    // Plant records still point at the species being deleted
    case '23503':
      return HAS_RECORDS_MESSAGE
    default:
      return queryErrorMessage(error)
  }
}

function photoUploadErrorMessage(error) {
  // Request never reached the server (offline, server unreachable)
  if (error.name === 'StorageUnknownError') {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  const status = Number(error.statusCode ?? error.status)
  if (status === 413 || /exceed|too large/i.test(error.message)) {
    return 'The photo must be 5 MB or smaller.'
  }
  if (status === 415 || /mime/i.test(error.message)) return 'Choose a JPEG or PNG photo.'
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(error.message)) {
    return 'Your account is not allowed to upload species photos.'
  }
  return 'The photo could not be uploaded. Try again.'
}
