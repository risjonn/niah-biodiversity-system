import { randomUUID } from 'expo-crypto'
import { File } from 'expo-file-system'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Private bucket set up by database/schema/006_plant_photos_storage.sql. Users can only upload
// into a folder named after their own id; officers and admins can read every folder.
const BUCKET = 'plant-photos'

// Plant photo uploads. Resolves to { data, error } and never throws: `error` is a message ready to
// show on screen (the same pattern as usePlants).
export function usePlantPhoto() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Uploads a JPEG already on the device and resolves to its storage path (not a URL), which is
  // what plants.photo_url holds. Callers pass the resized copy, never the camera original.
  async function uploadPlantPhoto(localUri) {
    if (!userId) {
      return { data: null, error: 'You need to be signed in to upload a photo.' }
    }

    let body
    try {
      // Sent as an ArrayBuffer: fetch(uri).blob() often uploads an empty file on React Native
      body = base64ToArrayBuffer(await new File(localUri).base64())
    } catch {
      return {
        data: null,
        error: 'The photo could not be read from your phone. Remove it and add it again.',
      }
    }

    const path = `${userId}/${randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: false })

    if (error) return { data: null, error: photoErrorMessage(error) }
    return { data: path, error: null }
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

  return { uploadPlantPhoto, getPlantPhotoUrl }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function photoErrorMessage(error) {
  // Request never reached the server (offline, server unreachable)
  if (error.name === 'StorageUnknownError') {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  const status = Number(error.statusCode ?? error.status)
  // The bucket's 5 MB limit
  if (status === 413) {
    return 'The photo is too large to upload. Remove it and choose a smaller one.'
  }
  // Row-level security refused the upload
  if (status === 403 || /row-level security/i.test(error.message)) {
    return 'Your account is not allowed to upload photos.'
  }
  return 'The photo could not be uploaded. Try again.'
}
