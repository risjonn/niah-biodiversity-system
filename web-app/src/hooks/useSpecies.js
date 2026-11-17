import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { containsAnyFilter, countResult, queryErrorMessage } from '../lib/queryHelpers'
import { conservationStatuses } from '../lib/conservationStatus'

// The species columns callers may set. id, created_by and the timestamps are managed here or by
// the database, so they are never taken from the caller. reference_photo_url isn't either: photos
// are saved in species_photos, and a trigger keeps reference_photo_url as the cover
// (database/schema/017), which older app versions and the species cards read.
const EDITABLE_FIELDS = [
  'scientific_name',
  'common_name',
  'family',
  'description',
  'conservation_status',
  'cultural_significance',
]

// The most photos a species can have (species_photos positions 0 to 4, 017)
export const MAX_SPECIES_PHOTOS = 5

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
    countSpeciesByConservationStatus,
    createSpecies,
    updateSpecies,
    deleteSpecies,
    getSpeciesPhotos,
    saveSpeciesPhotos,
    speciesPhotoError,
    uploadSpeciesPhoto,
    removeSpeciesPhoto,
  }
}

// A species' photos, cover first. Resolves to { data: [{ id, url, position }], error }. Public
// URLs, so nothing needs signing.
async function getSpeciesPhotos(speciesId) {
  const { data, error } = await supabase
    .from('species_photos')
    .select('id, photo_url, position')
    .eq('species_id', speciesId)
    .order('position')

  if (error) return { data: [], error: speciesPhotosErrorMessage(error) }
  return {
    data: data.map((row) => ({ id: row.id, url: row.photo_url, position: row.position })),
    error: null,
  }
}

// Saves a species' photos as the form left them.
// - original: the photos as loaded ([{ id, url, position }]), [] for a new species
// - photos: the photos to keep, in their new order, cover first: { id, url } for one already
//   saved, { id: null, url } for a newly uploaded one
// Removes the photos left out, adds the new ones in free positions, then puts them in order with
// reorder_species_photos, but only if the order changed. The trigger in 017 then keeps
// reference_photo_url as the cover. Afterwards, files nothing points at any more are removed from
// storage: removed photos, and new uploads whose row couldn't be added. Not transactional: on an
// error, the steps before it stay saved. Resolves to { data: true, error }.
async function saveSpeciesPhotos(speciesId, { original, photos }) {
  const keptIds = new Set(photos.filter((photo) => photo.id).map((photo) => photo.id))
  const kept = original.filter((photo) => keptIds.has(photo.id))
  const removed = original.filter((photo) => !keptIds.has(photo.id))
  const added = photos.filter((photo) => !photo.id)
  // Files to remove from storage at the end
  const removedUrls = []
  let unsavedUploadUrls = added.map((photo) => photo.url)

  function finish(error) {
    // Not awaited: removeSpeciesPhoto never fails and leaving the page doesn't stop it
    for (const url of [...removedUrls, ...unsavedUploadUrls]) removeSpeciesPhoto(url)
    return { data: error ? null : true, error }
  }

  if (removed.length > 0) {
    const { data, error } = await supabase
      .from('species_photos')
      .delete()
      .eq('species_id', speciesId)
      .in(
        'id',
        removed.map((photo) => photo.id),
      )
      .select('photo_url')
    if (error) return finish(speciesPhotosErrorMessage(error))
    // Only files whose row really went; RLS refusing the delete returns no rows
    removedUrls.push(...data.map((row) => row.photo_url))
  }

  // Every position the kept photos don't use, lowest first, for the new ones
  const keptPositions = kept.map((photo) => photo.position)
  const freePositions = [...Array(MAX_SPECIES_PHOTOS).keys()].filter(
    (position) => !keptPositions.includes(position),
  )
  if (added.length > freePositions.length) {
    return finish(`A species can have at most ${MAX_SPECIES_PHOTOS} photos.`)
  }

  const newIds = new Map()
  if (added.length > 0) {
    const { data, error } = await supabase
      .from('species_photos')
      .insert(
        added.map((photo, index) => ({
          species_id: speciesId,
          photo_url: photo.url,
          position: freePositions[index],
        })),
      )
      .select('id, photo_url')
    if (error) return finish(speciesPhotosErrorMessage(error))
    // Each upload has its own random name, so the URL identifies the new row
    for (const row of data) newIds.set(row.photo_url, row.id)
    unsavedUploadUrls = []
  }

  // The order they are in now (by position) against the order asked for
  const savedOrder = [
    ...kept.map((photo) => ({ id: photo.id, position: photo.position })),
    ...added.map((photo, index) => ({ id: newIds.get(photo.url), position: freePositions[index] })),
  ]
    .sort((a, b) => a.position - b.position)
    .map((photo) => photo.id)
  const wantedOrder = photos.map((photo) => photo.id ?? newIds.get(photo.url))

  if (wantedOrder.length > 0 && wantedOrder.join() !== savedOrder.join()) {
    const { error } = await supabase.rpc('reorder_species_photos', {
      p_species_id: speciesId,
      p_photo_ids: wantedOrder,
    })
    if (error) return finish(speciesPhotosErrorMessage(error))
  }

  return finish(null)
}

// How many species are in the database, without loading them
function countSpecies() {
  return countResult(supabase.from('species').select('*', { count: 'exact', head: true }))
}

// How many species have each conservation status, as { status, count } rows in the order of
// conservationStatuses (least to most threatened), with 0 for a status no species has. One count
// per status rather than loading every species, so the API's row limit can't cut the totals short.
async function countSpeciesByConservationStatus() {
  const results = await Promise.all(
    conservationStatuses.map((status) =>
      countResult(
        supabase
          .from('species')
          .select('*', { count: 'exact', head: true })
          .eq('conservation_status', status),
      ),
    ),
  )

  const failed = results.find((result) => result.error)
  if (failed) return { data: [], error: failed.error }
  return {
    data: conservationStatuses.map((status, index) => ({ status, count: results[index].data })),
    error: null,
  }
}

// All species, alphabetical by scientific name. `search` matches scientific name, common name or
// family. The species list filters by conservation status itself, so it can count each status.
async function fetchSpecies({ search } = {}) {
  let query = supabase.from('species').select('*').order('scientific_name')

  const searchFilter = containsAnyFilter(SEARCH_COLUMNS, search)
  if (searchFilter) query = query.or(searchFilter)

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

// Uploads a species photo under a new random name and resolves to its public URL, ready to save
// in species_photos
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

function speciesPhotosErrorMessage(error) {
  switch (error.code) {
    case '42501':
      return 'Your account is not allowed to change species photos.'
    // Two photos at one position, or reorder_species_photos was given a different set of photos:
    // someone else changed this species' photos at the same time
    case '23505':
    case '22023':
      return 'The photos were changed somewhere else while you were editing. Open the species again and redo your changes.'
    // More than 5 photos (limit_photos_per_record, 017); its message is written for people
    case '23514':
      return error.message
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
