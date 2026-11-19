import { useCallback, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabaseClient'

// The last plant list that downloaded, so guests can look up plant tags offline
const CACHE_KEY = 'niah-public-plants-cache'

// Supabase returns at most 1000 rows per request by default, so the list is fetched in pages
const PAGE_SIZE = 1000
const MAX_PLANTS = 2000

// Only the columns guest mode needs. has_photos (database/schema/017) says whether guests can see
// the plant's own photos (approved, unmonitored plants with photos), so the scan result only looks
// them up when there are some. The photos themselves are loaded from plant_photos when shown.
const COLUMNS =
  'id, species_id, qr_code, height_cm, morphological_notes, latitude, longitude, is_monitored, recorded_at, has_photos'

// Approved plants for guest mode, from the plants_public view (coordinates of monitored plants
// already rounded). Downloads the list when first used and saves it on the phone. Returns
// { data, error, savedAt, loading, reload, lookupByQrCode }: `error` is a message ready to show on
// screen, and `savedAt` is set when the server couldn't be reached and the saved list was used
// instead, the ISO time that list was downloaded (the same pattern as useSpecies).
export function usePublicPlants() {
  // null while loading
  const [result, setResult] = useState(null)

  const reload = useCallback(() => {
    setResult(null)
    return fetchPublicPlants().then(setResult)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchPublicPlants().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const plantsByCode = useMemo(
    () => new Map((result?.data ?? []).map((plant) => [plant.qr_code, plant])),
    [result],
  )

  // Finds a plant by its QR code in the downloaded list, without a network call. Returns
  // { data, error } with data null when no approved plant has that code.
  const lookupByQrCode = useCallback(
    (code) => {
      if (!result) {
        return { data: null, error: 'Plant data is still loading. Try again in a moment.' }
      }
      if (result.error) return { data: null, error: result.error }
      return { data: plantsByCode.get(code) ?? null, error: null }
    },
    [result, plantsByCode],
  )

  return {
    data: result?.data ?? [],
    error: result?.error ?? null,
    savedAt: result?.savedAt ?? null,
    loading: !result,
    reload,
    lookupByQrCode,
  }
}

async function fetchPublicPlants() {
  const { data, error } = await fetchAllPages()

  if (!error) {
    await savePlants(data)
    return { data, error: null, savedAt: null }
  }

  const saved = await readSavedPlants()
  if (saved) return { data: saved.plants, error: null, savedAt: saved.savedAt }
  return { data: [], error: plantsErrorMessage(error), savedAt: null }
}

// Every page up to MAX_PLANTS, ordered by id so pages don't overlap. Fails as a whole if any page
// fails, so a partial list is never saved over a complete one.
async function fetchAllPages() {
  const plants = []
  for (let from = 0; from < MAX_PLANTS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('plants_public')
      .select(COLUMNS)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)

    if (error) return { data: null, error }
    plants.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return { data: plants, error: null }
}

async function savePlants(plants) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), plants }),
    )
  } catch {
    // The fresh list is still returned; the previously saved one stays as the fallback
  }
}

async function readSavedPlants() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(CACHE_KEY))
    return Array.isArray(saved?.plants) && saved.savedAt ? saved : null
  } catch {
    return null
  }
}

function plantsErrorMessage(error) {
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Connect to the internet once to download plant data.'
    default:
      return error.message
  }
}
