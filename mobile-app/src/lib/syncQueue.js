import { supabase } from './supabaseClient'
import {
  cleanUpQueue,
  getNextPendingPlant,
  getQueuedPhoto,
  markFailed,
  markPending,
  markPhotoRowsSaved,
  markPhotoUploaded,
  markPlantSaved,
  markSynced,
  markSyncing,
} from './offlineQueue'

// Sends queued plant records (lib/offlineQueue.js) to the server, oldest first, one at a time.
// A network error stops the run and leaves the record waiting for the next one; any other error
// marks that record failed, with a message ready to show, and the run carries on.
//
// Each record goes in three steps, and the queue remembers each one as it succeeds, so a retry
// (automatic, or Try again) only does what is left:
//   a. every photo is uploaded to its own storage_path (a file already there counts as uploaded:
//      the path is unique to that photo, so it can only be this photo from an earlier attempt)
//   b. the plant row is inserted, without photo_url, with the id made on the phone (if an earlier
//      attempt saved it but the reply was lost, the duplicate id says so and it is read back)
//   c. the plant_photos rows are inserted at positions 0..n-1; the trigger in 017 then sets
//      photo_url to the cover. Rows that may already exist from an earlier attempt are looked up
//      first, so only the missing ones are added.

// Photo error codes from usePlantPhoto that may work if tried again later
const TRANSIENT_PHOTO_CODES = ['network', 'server', 'auth']

const MISSING_PHOTO_MESSAGE =
  'A photo saved with this record is missing from the phone. Discard this record and register the plant again.'
const ID_TAKEN_MESSAGE =
  'This record could not be saved because its ID is already in use. Discard it and register the plant again.'
const UNEXPECTED_MESSAGE = 'Something went wrong while syncing this record. Try again.'
// Replaces usePlants' form message for 23503, which asks for a different species: a queued
// record's species can't be changed
const SPECIES_REMOVED_MESSAGE =
  "This record's species has been removed from the species list. Discard it and register the plant again with another species."

// Single-flight: only one run at a time. Callers that arrive during a run share its result, and
// one more run follows it so nothing they asked for is missed.
let currentRun = null
let rerunRequested = false
let latestOptions = null

// options: { userId, uploadPlantPhoto, submitPlant, fetchPlant, addPlantPhotos,
//            fetchPlantPhotoPaths, onChange }
//   The five functions are usePlantPhoto's and usePlants' for the signed-in user. onChange is
//   called whenever a record's status changes.
// Resolves to { synced, failed, stopped }: how many records synced and failed, and why the run
// stopped early ('network' or 'signed_out') or null if it got through the whole queue.
export function runSync(options) {
  latestOptions = options
  if (currentRun) {
    rerunRequested = true
    return currentRun
  }

  currentRun = (async () => {
    try {
      let result
      do {
        rerunRequested = false
        result = await syncQueuedPlants(latestOptions)
      } while (rerunRequested)
      return result
    } finally {
      currentRun = null
    }
  })()
  return currentRun
}

export function isSyncRunning() {
  return currentRun !== null
}

async function syncQueuedPlants(options) {
  const { userId, onChange } = options
  const result = { synced: 0, failed: 0, stopped: null }

  try {
    for (;;) {
      // Checked before every record: if the token couldn't be refreshed, requests would go out
      // without the botanist's sign-in and row-level security would refuse a good record
      if (!(await hasSessionFor(userId))) {
        result.stopped = 'signed_out'
        break
      }

      const record = await getNextPendingPlant(userId)
      if (!record) break

      await markSyncing(record.id)
      onChange?.()

      let outcome
      try {
        outcome = await syncRecord(record, options)
      } catch {
        outcome = { type: 'failed', message: UNEXPECTED_MESSAGE }
      }

      if (outcome.type === 'synced') {
        await markSynced(record.id, outcome.qrCode)
        result.synced++
      } else if (outcome.type === 'failed') {
        await markFailed(record.id, outcome.message)
        result.failed++
      } else {
        await markPending(record.id, outcome.message)
        result.stopped = 'network'
      }
      onChange?.()

      if (result.stopped) break
    }
  } finally {
    await cleanUpQueue()
  }
  return result
}

// Resolves to { type: 'synced', qrCode }, { type: 'failed', message } or { type: 'retry', message }
async function syncRecord(record, options) {
  const photos = record.photos ?? []

  // a. Every photo not uploaded yet, cover first
  for (const photo of photos) {
    if (photo.uploaded) continue
    const file = photo.local_path ? getQueuedPhoto(photo.local_path) : null
    if (!file?.exists) return { type: 'failed', message: MISSING_PHOTO_MESSAGE }

    const upload = await options.uploadPlantPhoto(file.uri, photo.storage_path)
    if (upload.error && upload.code !== 'already_exists') {
      return TRANSIENT_PHOTO_CODES.includes(upload.code)
        ? { type: 'retry', message: upload.error }
        : { type: 'failed', message: upload.error }
    }
    await markPhotoUploaded(record.id, photo.position)
  }

  // b. The plant, unless an earlier attempt saved it
  let qrCode = record.qr_code
  let insertedNow = false
  if (!record.plant_saved) {
    const saved = await savePlant(record, options)
    if (saved.type !== 'saved') return saved
    qrCode = saved.qrCode
    insertedNow = saved.insertedNow
    await markPlantSaved(record.id, qrCode)
  }

  // c. The plant_photos rows not saved yet
  const rows = await savePhotoRows(record, photos, { ...options, qrCode, insertedNow })
  if (rows) return rows
  return { type: 'synced', qrCode }
}

// Resolves to { type: 'saved', qrCode, insertedNow }, or a failed or retry outcome
async function savePlant(record, { submitPlant, fetchPlant }) {
  // With the id generated on the phone, so if an earlier attempt was saved but its response was
  // lost, this one fails as a duplicate instead of saving the plant twice. No photo_url: the
  // photos are added as plant_photos rows, and the database sets photo_url to the cover.
  const insert = await submitPlant({
    id: record.id,
    recorded_at: record.recorded_at,
    species_id: record.species_id,
    height_cm: record.height_cm,
    morphological_notes: record.morphological_notes,
    location_description: record.location_description,
    latitude: record.latitude,
    longitude: record.longitude,
  })
  if (!insert.error) return { type: 'saved', qrCode: insert.data.qr_code, insertedNow: true }

  if (insert.alreadySaved) {
    const existing = await fetchPlant(record.id)
    if (existing.data) return { type: 'saved', qrCode: existing.data.qr_code, insertedNow: false }
    if (existing.error && isTransientPlantError(existing)) {
      return { type: 'retry', message: existing.error }
    }
    return { type: 'failed', message: existing.error ?? ID_TAKEN_MESSAGE }
  }

  if (isTransientPlantError(insert)) return { type: 'retry', message: insert.error }
  // species_id no longer matches a species
  if (insert.code === '23503') return { type: 'failed', message: SPECIES_REMOVED_MESSAGE }
  return { type: 'failed', message: insert.error }
}

// Adds the photos' plant_photos rows that aren't saved yet. Resolves to null when they all are,
// or to a failed or retry outcome. A failure here leaves the plant saved, so the next attempt
// only adds the rows.
async function savePhotoRows(record, photos, { addPlantPhotos, fetchPlantPhotoPaths, qrCode, insertedNow }) {
  let missing = photos.filter((photo) => !photo.row_saved)
  if (missing.length === 0) return null

  // Rows an earlier attempt (or, for a record queued before multiple photos, the old photo_url
  // trigger) may already have added. A plant inserted just now has none.
  async function dropRowsAlreadySaved() {
    const existing = await fetchPlantPhotoPaths(record.id)
    if (existing.error) return existing
    const onServer = new Set(existing.data)
    const found = missing.filter((photo) => onServer.has(photo.storage_path))
    await markPhotoRowsSaved(record.id, found.map((photo) => photo.position))
    missing = missing.filter((photo) => !onServer.has(photo.storage_path))
    return null
  }

  if (!insertedNow) {
    const lookup = await dropRowsAlreadySaved()
    if (lookup) return photoRowsOutcome(lookup, qrCode)
    if (missing.length === 0) return null
  }

  const toRows = () => missing.map((photo) => ({ storage_path: photo.storage_path, position: photo.position }))
  let added = await addPlantPhotos(record.id, toRows())
  // A row is already there (unique plant and position, or unique file): look again and add only
  // what is still missing
  if (added.error && added.code === '23505') {
    const lookup = await dropRowsAlreadySaved()
    if (lookup) return photoRowsOutcome(lookup, qrCode)
    added = missing.length > 0 ? await addPlantPhotos(record.id, toRows()) : { error: null }
  }
  if (added.error) return photoRowsOutcome(added, qrCode)

  await markPhotoRowsSaved(record.id, missing.map((photo) => photo.position))
  return null
}

function photoRowsOutcome(failure, qrCode) {
  if (isTransientPlantError(failure)) return { type: 'retry', message: failure.error }
  return {
    type: 'failed',
    message: `The plant was saved as ${qrCode}, but its photos couldn't be added: ${lowerFirst(failure.error)}`,
  }
}

function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : 'unknown error.'
}

// Whether a usePlants failure ({ code, status }) may work if tried again later
export function isTransientPlantError({ code, status }) {
  // The request never reached the database, or a gateway answered without a database error
  if (!code) return true
  // No valid sign-in reached the database (PostgREST answers 401 for the anonymous role)
  if (status === 401) return true
  // Connection exception, insufficient resources, operator intervention (e.g. statement timeout),
  // transaction rollback (serialization failure, deadlock)
  if (/^(08|53|57|40)/.test(code)) return true
  // PostgREST couldn't reach the database, or the JWT was expired or invalid
  if (/^PGRST(00[0-3]|30[0-3])$/.test(code)) return true
  return false
}

async function hasSessionFor(userId) {
  try {
    const { data } = await supabase.auth.getSession()
    return !!userId && data.session?.user?.id === userId
  } catch {
    return false
  }
}
