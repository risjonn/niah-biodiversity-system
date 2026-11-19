import { getQueuedPhoto } from './offlineQueue'

// A synced queue row (lib/offlineQueue.js) in the shape of a server plant row, with the species
// names it was saved with. It is saved on the server, so pending review. Lets Records and the
// Register success screen open Record detail even before the server list has it (or offline).
// photo_url is the cover's storage path, as the database sets it once the photos are added.
export function queuedRecordAsPlant(record) {
  return {
    id: record.id,
    qr_code: record.qr_code,
    species_id: record.species_id,
    review_status: 'pending_review',
    recorded_at: record.recorded_at,
    latitude: record.latitude,
    longitude: record.longitude,
    location_description: record.location_description,
    height_cm: record.height_cm,
    morphological_notes: record.morphological_notes,
    photo_url: record.photos?.[0]?.storage_path ?? null,
    species_scientific_name: record.species_scientific_name,
    species_common_name: record.species_common_name,
  }
}

// The copy of the cover photo saved with a queued record, or undefined when there is none (or it
// has been deleted after syncing)
export function queuedCoverUri(record) {
  const relativePath = record.photos?.[0]?.local_path
  if (!relativePath) return undefined
  try {
    return getQueuedPhoto(relativePath).uri
  } catch {
    return undefined
  }
}
