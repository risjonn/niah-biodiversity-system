import { supabase } from './supabaseClient'
import {
  cleanUpQueue,
  getNextPendingPlant,
  getQueuedPhoto,
  markFailed,
  markPending,
  markSynced,
  markSyncing,
  setUploadedPhotoPath,
} from './offlineQueue'

// Sends queued plant records (lib/offlineQueue.js) to the server, oldest first, one at a time.
// A network error stops the run and leaves the record waiting for the next one; any other error
// marks that record failed, with a message ready to show, and the run carries on.

// Photo error codes from usePlantPhoto that may work if tried again later
const TRANSIENT_PHOTO_CODES = ['network', 'server', 'auth']

const MISSING_PHOTO_MESSAGE =
  'The photo saved with this record is missing from the phone. Discard this record and register the plant again.'
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

// options: { userId, uploadPlantPhoto, submitPlant, fetchPlant, onChange }
//   The three functions are usePlantPhoto's and usePlants' for the signed-in user. onChange is
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
async function syncRecord(record, { userId, uploadPlantPhoto, submitPlant, fetchPlant }) {
  let photoPath = record.uploaded_photo_path

  // a. The photo goes up first, under the record's own id so a retry finds it already there
  if (record.local_photo_path && !photoPath) {
    const photo = getQueuedPhoto(record.local_photo_path)
    if (!photo.exists) return { type: 'failed', message: MISSING_PHOTO_MESSAGE }

    const path = `${userId}/${record.id}.jpg`
    const upload = await uploadPlantPhoto(photo.uri, path)
    if (upload.error && upload.code !== 'already_exists') {
      return TRANSIENT_PHOTO_CODES.includes(upload.code)
        ? { type: 'retry', message: upload.error }
        : { type: 'failed', message: upload.error }
    }
    await setUploadedPhotoPath(record.id, path)
    photoPath = path
  }

  // b. The record, with the id generated on the phone, so if an earlier attempt was saved but its
  // response was lost, this one fails as a duplicate instead of saving the plant twice
  const insert = await submitPlant({
    id: record.id,
    recorded_at: record.recorded_at,
    species_id: record.species_id,
    height_cm: record.height_cm,
    morphological_notes: record.morphological_notes,
    location_description: record.location_description,
    latitude: record.latitude,
    longitude: record.longitude,
    photo_url: photoPath ?? null,
  })
  if (!insert.error) return { type: 'synced', qrCode: insert.data.qr_code }

  if (insert.alreadySaved) {
    const existing = await fetchPlant(record.id)
    if (existing.data) return { type: 'synced', qrCode: existing.data.qr_code }
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
