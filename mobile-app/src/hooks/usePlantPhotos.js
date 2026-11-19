import { useEffect, useState } from 'react'
import { getPlantPhotos } from './usePlantPhoto'

// A plant's photos, cover first, signed in one request (see getPlantPhotos). Read-only.
// `coverPath` is the plant's photo_url, used if it has no plant_photos rows; pass null when it
// isn't known (a guest). With `enabled` false nothing is loaded.
// Returns { photos: [{ path, uri }], error, loading }.
export function usePlantPhotos(plantId, coverPath = null, { enabled = true } = {}) {
  const active = enabled && Boolean(plantId)
  // Kept with what it was loaded for, so a slow earlier load can't show on another plant
  const loadKey = `${plantId}|${coverPath ?? ''}`
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    getPlantPhotos(plantId, coverPath).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, loadKey })
    })
    return () => {
      cancelled = true
    }
  }, [active, plantId, coverPath, loadKey])

  const loading = active && result?.loadKey !== loadKey
  if (!active || loading) return { photos: [], error: null, loading }
  return { photos: result.data, error: result.error, loading: false }
}
