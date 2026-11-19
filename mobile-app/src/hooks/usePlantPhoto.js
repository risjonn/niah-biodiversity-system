import { randomUUID } from 'expo-crypto'
import { File } from 'expo-file-system'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Private bucket set up by database/schema/006_plant_photos_storage.sql. Users can only upload
// into a folder named after their own id; officers and admins can read every folder.
const BUCKET = 'plant-photos'

// Plant photo uploads. Resolves to { data, error } and never throws: `error` is a message ready to
// show on screen (the same pattern as usePlants). Failures also carry `code`, saying what went
// wrong: 'network', 'server' and 'auth' may work if tried again later; 'already_exists',
// 'too_large', 'forbidden', 'unreadable', 'signed_out' and 'unknown' won't.
export function usePlantPhoto() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Uploads a JPEG already on the device and resolves to its storage path (not a URL), which is
  // what plants.photo_url holds. Callers pass the resized copy, never the camera original.
  // `path` defaults to a new random name in the user's folder. Nothing is overwritten: if a file
  // is already at `path` the upload fails with code 'already_exists'.
  async function uploadPlantPhoto(localUri, path) {
    if (!userId) {
      return {
        data: null,
        error: 'You need to be signed in to upload a photo.',
        code: 'signed_out',
      }
    }

    let body
    try {
      // Sent as an ArrayBuffer: fetch(uri).blob() often uploads an empty file on React Native
      body = base64ToArrayBuffer(await new File(localUri).base64())
    } catch {
      return {
        data: null,
        error: 'The photo could not be read from your phone. Remove it and add it again.',
        code: 'unreadable',
      }
    }

    const storagePath = path ?? `${userId}/${randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, body, { contentType: 'image/jpeg', upsert: false })

    if (error) {
      const code = photoErrorCode(error)
      return { data: null, error: PHOTO_ERROR_MESSAGES[code], code }
    }
    return { data: storagePath, error: null }
  }

  async function getPlantPhotoUrl(photoPath) {
    if (!photoPath) {
      return { data: null, error: null }
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photoPath, 60 * 60)

    if (error) {
      return { data: null, error: error.message }
    }

    return { data: data.signedUrl, error: null }
  }

  return {
    uploadPlantPhoto,
    getPlantPhotoUrl,
    getPlantPhotos,
    countPlantPhotos,
    addPlantPhotos,
    fetchPlantPhotoPaths,
    removePlantPhotos,
  }
}

// Long enough to look through a record, short enough that a copied link soon stops working
const SIGNED_URL_SECONDS = 60 * 60

// Every photo of one plant, cover first (plant_photos, database/schema/017), each signed for
// viewing. All of them are signed in one request. `coverPath` is the plant's photo_url, used when
// it has no plant_photos rows. Works for guests too: they can read the rows and sign the files of
// approved plants that aren't monitored, and get no rows for any other plant.
// Resolves to { data: [{ path, uri }], error }; uri is null for a photo storage couldn't sign.
export async function getPlantPhotos(plantId, coverPath = null) {
  const { data: rows, error } = await supabase
    .from('plant_photos')
    .select('storage_path, position')
    .eq('plant_id', plantId)
    .order('position')

  if (error) return { data: [], error: queryErrorMessage(error) }
  const paths = rows.length > 0 ? rows.map((row) => row.storage_path) : coverPath ? [coverPath] : []
  if (paths.length === 0) return { data: [], error: null }

  const signed = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  if (signed.error) return { data: [], error: 'The photos could not be loaded. Try again later.' }
  const urls = new Map(
    (signed.data ?? []).filter((item) => item.signedUrl && !item.error).map((item) => [item.path, item.signedUrl]),
  )
  return { data: paths.map((path) => ({ path, uri: urls.get(path) ?? null })), error: null }
}

// How many photos each of these plants has, for the "+2" badge on list thumbnails. Resolves to
// { data: { [plantId]: count }, error }, leaving out plants with none. One request per 100 plants
// (at most 500 rows, under the API's 1000-row limit) rather than one per plant.
export async function countPlantPhotos(plantIds) {
  const ids = [...new Set(plantIds.filter(Boolean))]
  const counts = {}
  for (let start = 0; start < ids.length; start += COUNT_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('plant_photos')
      .select('plant_id')
      .in('plant_id', ids.slice(start, start + COUNT_BATCH_SIZE))
    if (error) return { data: counts, error: queryErrorMessage(error) }
    for (const row of data) counts[row.plant_id] = (counts[row.plant_id] ?? 0) + 1
  }
  return { data: counts, error: null }
}

const COUNT_BATCH_SIZE = 100

// Adds a plant's photos: rows is [{ storage_path, position }]. Row-level security allows this only
// for the plant's recorder while it is pending review, for files in their own folder. Resolves to
// { data: true, error, code, status }, with code and status as from usePlants (for the sync queue).
export async function addPlantPhotos(plantId, rows) {
  const { error } = await supabase
    .from('plant_photos')
    .insert(rows.map((row) => ({ plant_id: plantId, storage_path: row.storage_path, position: row.position })))
  if (error) return { data: null, error: photoRowErrorMessage(error), code: error.code ?? '', status: error.status }
  return { data: true, error: null }
}

// The storage paths of a plant's photo rows, as { data: [path], error, code, status }
export async function fetchPlantPhotoPaths(plantId) {
  const { data, error } = await supabase.from('plant_photos').select('storage_path').eq('plant_id', plantId)
  if (error) return { data: [], error: queryErrorMessage(error), code: error.code ?? '', status: error.status }
  return { data: data.map((row) => row.storage_path), error: null }
}

// Removes uploaded files no record uses (a discarded record's). Best effort: resolves to
// { data: removedCount, error: null } and never fails, since a leftover file in the user's own
// folder is private and attached to no plant. Storage removes nothing, without an error, for
// files the user isn't allowed to delete.
export async function removePlantPhotos(paths) {
  if (paths.length === 0) return { data: 0, error: null }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) throw error
    return { data: data?.length ?? 0, error: null }
  } catch {
    return { data: 0, error: null }
  }
}

function queryErrorMessage(error) {
  // Request never reached the database (offline, server unreachable)
  if (!error.code) return 'Unable to reach the server. Check your connection and try again.'
  return error.message
}

function photoRowErrorMessage(error) {
  switch (error.code) {
    case '':
    case undefined:
      return 'Unable to reach the server. Check your connection and try again.'
    // Row-level security: the record is no longer pending, or isn't the user's
    case '42501':
      return 'Photos can only be added to your own records while they wait for review.'
    // The 5-photo limit (017); its message is written for people
    case '23514':
      return error.message
    default:
      return error.message
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

const PHOTO_ERROR_MESSAGES = {
  network: 'Unable to reach the server. Check your connection and try again.',
  server: 'The server could not take the photo right now. Try again later.',
  auth: 'Your sign-in needs to be refreshed. Try again once you are online.',
  already_exists: 'This photo has already been uploaded.',
  too_large: 'The photo is too large to upload. Remove it and choose a smaller one.',
  forbidden: 'Your account is not allowed to upload photos.',
  unknown: 'The photo could not be uploaded. Try again.',
}

// Storage errors carry the HTTP status in `status` and the storage API's own code in `statusCode`
// (which can differ: some failures come back as HTTP 400 with statusCode '409' or '403')
export function photoErrorCode(error) {
  // Request never reached the server (offline, server unreachable)
  if (error.name === 'StorageUnknownError') return 'network'

  const statusCode = Number(error.statusCode ?? error.status)
  const status = Number(error.status)
  const text = `${error.message ?? ''} ${error.error ?? ''} ${error.code ?? ''} ${error.statusCode ?? ''}`

  if (statusCode === 409 || status === 409 || /already exists|duplicate/i.test(text)) {
    return 'already_exists'
  }
  // The bucket's 5 MB limit
  if (statusCode === 413 || status === 413) return 'too_large'
  // Expired or invalid token, which storage can report as a plain 400: '"exp" claim timestamp
  // check failed'
  if (statusCode === 401 || status === 401 || /jwt|exp"? claim/i.test(text)) return 'auth'
  // Row-level security refused the upload
  if (statusCode === 403 || status === 403 || /row-level security/i.test(text)) return 'forbidden'
  if (
    status === 0 ||
    statusCode >= 500 ||
    status >= 500 ||
    [408, 429].includes(statusCode) ||
    [408, 429].includes(status)
  ) {
    return 'server'
  }
  return 'unknown'
}
