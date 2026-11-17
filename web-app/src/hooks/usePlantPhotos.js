import { useEffect, useState } from 'react'
import { usePlants } from './usePlants'

// A plant record's photos, cover first, with signed URLs (see getPlantPhotos in usePlants).
// Read-only. Returns { photos, error, loading }: photos is [{ id, path, url }] once loaded.
// Loads again when the record or its cover changes.
export function usePlantPhotos(plant) {
  const { getPlantPhotos } = usePlants()
  const plantId = plant?.id ?? null
  const coverPath = plant?.photo_url || null
  // Kept with the record it was loaded for, so a slow earlier load can't show on another record
  const loadKey = `${plantId}|${coverPath}`
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!plantId) return undefined
    let cancelled = false
    getPlantPhotos(plantId, coverPath).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, loadKey })
    })
    return () => {
      cancelled = true
    }
  }, [getPlantPhotos, plantId, coverPath, loadKey])

  const loading = Boolean(plantId) && result?.loadKey !== loadKey
  return {
    photos: loading || !plantId ? [] : result.data,
    error: loading || !plantId ? null : result.error,
    loading,
  }
}
