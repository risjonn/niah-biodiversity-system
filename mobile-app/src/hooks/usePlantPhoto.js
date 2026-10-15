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

  return { uploadPlantPhoto }
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
