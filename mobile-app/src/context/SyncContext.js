import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { useAuth } from './AuthContext'
import { usePlantPhoto } from '../hooks/usePlantPhoto'
import { usePlants } from '../hooks/usePlants'
import { useSpecies } from '../hooks/useSpecies'
import {
  discardPlant,
  getQueuedPlants,
  markQrShown,
  queuePlant,
  queuePlants,
  retryPlant,
} from '../lib/offlineQueue'
import { runSync } from '../lib/syncQueue'
import { supabase } from '../lib/supabaseClient'

// Development-only test batch (Settings): this many records near Niah National Park
const TEST_RECORD_COUNT = 50
const TEST_RECORD_NOTES = 'TEST-10 batch'
const NIAH_CENTRE = { latitude: 3.8167, longitude: 113.7667 }

// Development-only "Pause automatic sync" (Settings), kept across launches so queued records can
// be tested through a force-close without the start-up sync sending them
const PAUSE_KEY = 'niah-dev-pause-sync'

const SyncContext = createContext(null)

// The signed-in user's offline queue and the automatic syncing of it. Every plant registration
// goes through queueRecord, and syncs run on app start, when the connection comes back, when the
// app returns to the foreground, after a sign-in or token refresh, right after a record is
// queued, and from "Sync now".
export function SyncProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { submitPlant, fetchPlant } = usePlants()
  const { uploadPlantPhoto } = usePlantPhoto()
  const { fetchSpecies } = useSpecies()

  // Every queued record for the signed-in user, oldest first (rows of lib/offlineQueue.js)
  const [records, setRecords] = useState([])
  const [syncing, setSyncing] = useState(false)
  // Bumped after every run that synced at least one record, so screens can reload server data
  const [syncedVersion, setSyncedVersion] = useState(0)
  // Development builds only: automatic triggers do nothing while this is on
  const [paused, setPausedState] = useState(false)
  // What automatic syncs check: null until the saved setting has loaded, then true or false
  const pausedRef = useRef(null)
  // The setting saved on the phone, read once per launch. Automatic syncs wait for it.
  const [savedPause] = useState(loadSavedPause)

  useEffect(() => {
    let active = true
    savedPause.then((saved) => {
      // A switch flipped before the saved setting loaded wins
      if (pausedRef.current === null) pausedRef.current = saved
      if (active) setPausedState(pausedRef.current)
    })
    return () => {
      active = false
    }
  }, [savedPause])

  const setPaused = useCallback((value) => {
    pausedRef.current = value
    setPausedState(value)
    if (__DEV__) AsyncStorage.setItem(PAUSE_KEY, JSON.stringify(value)).catch(() => {})
  }, [])

  // Read inside callbacks so they always act for the current user without being recreated.
  // Declared before the effects below so it is up to date when they run.
  const latest = useRef({})
  useEffect(() => {
    latest.current = { userId, submitPlant, fetchPlant, uploadPlantPhoto, savedPause }
  })

  const refresh = useCallback(async () => {
    // Signed out: the rows already read are filtered out by user below
    const forUser = latest.current.userId
    if (!forUser) return
    try {
      const rows = await getQueuedPlants(forUser)
      if (latest.current.userId === forUser) setRecords(rows)
    } catch {
      // The queue couldn't be read; the last list read stays on screen
    }
  }, [])

  // Resolves to runSync's result, or null if no sync ran. `manual` runs even while automatic
  // syncing is paused or the phone reports being offline. Automatic syncs first wait for the
  // saved pause setting, so one triggered at launch can't run before it is known.
  const sync = useCallback(
    async ({ manual = false } = {}) => {
      const { userId: forUser, savedPause: savedSetting, ...hooks } = latest.current
      if (!forUser) return null
      if (!manual) {
        const saved = await savedSetting
        // A switch flipped before the saved setting loaded wins
        if (pausedRef.current === null) pausedRef.current = saved
        if (pausedRef.current) return null
        const network = await NetInfo.fetch()
        if (network.isConnected === false) return null
      }

      setSyncing(true)
      try {
        const result = await runSync({
          userId: forUser,
          uploadPlantPhoto: hooks.uploadPlantPhoto,
          submitPlant: hooks.submitPlant,
          fetchPlant: hooks.fetchPlant,
          onChange: refresh,
        })
        if (result.synced > 0) setSyncedVersion((version) => version + 1)
        return result
      } catch {
        // The queue database itself failed; records stay as they are for the next run
        return null
      } finally {
        setSyncing(false)
        await refresh()
      }
    },
    [refresh],
  )

  // App start, sign-in and sign-out
  useEffect(() => {
    refresh()
    // sync() awaits the saved pause setting before any state changes, which the rule can't see;
    // covered by the "pause saved as on" tests
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId) sync()
  }, [userId, refresh, sync])

  // The connection coming back
  useEffect(() => {
    let wasOnline = null
    return NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false
      if (online && wasOnline === false) sync()
      wasOnline = online
    })
  }, [sync])

  // The app returning to the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh()
        sync()
      }
    })
    return () => subscription.remove()
  }, [refresh, sync])

  // A sign-in or token refresh: after the app started offline, the session only becomes usable
  // once its token refreshes, which can be a minute after the connection comes back
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Outside the callback, which Supabase asks to keep quick
        setTimeout(() => sync(), 0)
      }
    })
    return () => subscription.unsubscribe()
  }, [sync])

  // Saves a registration on the phone and starts syncing it. Resolves to { data, error, attempt }:
  // data is the queued row, error a message ready to show if it couldn't be saved (nothing is
  // queued then), and attempt the sync started for it (see sync).
  //   plant: { species, height_cm, morphological_notes, location_description, latitude,
  //            longitude, photoUri }
  const queueRecord = useCallback(
    async (plant) => {
      const forUser = latest.current.userId
      if (!forUser) {
        return { data: null, error: 'You need to be signed in to submit a plant record.' }
      }

      let row
      try {
        row = await queuePlant({ ...plant, userId: forUser, recorded_at: new Date().toISOString() })
      } catch {
        return {
          data: null,
          error: 'The record could not be saved on this phone. Check there is free storage space and try again.',
        }
      }
      await refresh()
      return { data: row, error: null, attempt: sync() }
    },
    [refresh, sync],
  )

  const syncNow = useCallback(() => sync({ manual: true }), [sync])

  // Puts a failed record back in line and syncs it
  const retry = useCallback(
    async (id) => {
      await retryPlant(id)
      await refresh()
      return sync({ manual: true })
    },
    [refresh, sync],
  )

  const discard = useCallback(
    async (id) => {
      await discardPlant(id)
      await refresh()
    },
    [refresh],
  )

  // Synced records whose QR code has been shown in My Records; removed at the next clean-up
  const markShown = useCallback(async (ids) => {
    try {
      await markQrShown(ids)
    } catch {
      // Removed after 7 days instead
    }
  }, [])

  // Development builds only. Resolves to { data: count, error }.
  const addTestRecords = useCallback(async () => {
    const forUser = latest.current.userId
    if (!forUser) return { data: 0, error: 'You need to be signed in.' }

    const { data: species, error } = await fetchSpecies()
    if (error) return { data: 0, error }
    if (species.length === 0) return { data: 0, error: 'There are no species to use.' }

    const recordedAt = new Date().toISOString()
    const plants = Array.from({ length: TEST_RECORD_COUNT }, () => ({
      userId: forUser,
      species: species[Math.floor(Math.random() * species.length)],
      height_cm: Math.round(20 + Math.random() * 480),
      morphological_notes: TEST_RECORD_NOTES,
      location_description: null,
      // Within about 1 km of the park centre
      latitude: NIAH_CENTRE.latitude + (Math.random() - 0.5) * 0.02,
      longitude: NIAH_CENTRE.longitude + (Math.random() - 0.5) * 0.02,
      recorded_at: recordedAt,
      photoUri: null,
    }))

    try {
      await queuePlants(plants)
    } catch {
      return { data: 0, error: 'The test records could not be saved on this phone.' }
    }
    await refresh()
    sync()
    return { data: plants.length, error: null }
  }, [fetchSpecies, refresh, sync])

  // Until the queue is read again after a sign-in, `records` can still hold the last user's rows
  const userRecords = records.filter((record) => record.user_id === userId)
  const waitingCount = userRecords.filter(
    (record) => record.status === 'pending' || record.status === 'syncing',
  ).length
  const failedCount = userRecords.filter((record) => record.status === 'failed').length

  const value = {
    records: userRecords,
    // Records still to sync, and records that couldn't sync and need the botanist
    waitingCount,
    failedCount,
    unsyncedCount: waitingCount + failedCount,
    syncing,
    syncedVersion,
    queueRecord,
    syncNow,
    retry,
    discard,
    markShown,
    paused,
    setPaused,
    addTestRecords,
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSync must be used inside a SyncProvider')
  }
  return context
}

// Resolves to the saved "Pause automatic sync" setting. Always off outside development builds.
async function loadSavedPause() {
  if (!__DEV__) return false
  try {
    return JSON.parse(await AsyncStorage.getItem(PAUSE_KEY)) === true
  } catch {
    return false
  }
}
