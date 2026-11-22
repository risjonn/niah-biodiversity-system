import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import { useAuth } from './AuthContext'
import {
  UNLOCK_METHOD_NAME,
  cancelDeviceOwnerPrompt,
  confirmDeviceOwner,
  getDeviceSecurity,
  readUnlockChoice,
  saveUnlockChoice,
} from '../lib/appLock'

// Coming back to the app after this long in the background asks for Face ID, a fingerprint or
// the passcode again
const LOCK_AFTER_MS = 5 * 60 * 1000
// A prompt that hasn't answered by then is given up on, so the lock screen never spins forever
const PROMPT_TIMEOUT_MS = 30 * 1000

const AppLockContext = createContext(null)

// Biometric unlock for signed-in staff. When it is on, the app locks on launch (including when it
// starts offline with the saved account) and after 5 minutes in the background, and RootNavigator
// shows the lock screen in place of every other screen until the user unlocks. Guests are never
// locked, and nor is anyone on a phone with no biometrics or passcode set up.
export function AppLockProvider({ children }) {
  const { user, role, isLoading, signedInWithPassword } = useAuth()
  // Only signed-in staff with a role; a guest has neither a user nor a role
  const userId = !isLoading && role ? (user?.id ?? null) : null
  // A password sign-in starts unlocked, while the same account restored on launch starts locked,
  // so the two are kept apart. Signing out passes through null, so the next sign-in starts afresh.
  const lockKey = userId ? `${userId}:${signedInWithPassword ? 'password' : 'restored'}` : null

  // For lockKey: { key, userId, device, enabled, locked } (device from getDeviceSecurity). Stays
  // with the key it was loaded for, so one account's lock never carries over to the next.
  const [lock, setLock] = useState(null)
  // A blank screen over the app while it is in the background, so coming back doesn't show the
  // records for a moment before the lock screen
  const [covered, setCovered] = useState(false)
  // True while the biometric prompt is up. It sends the app to the background on Android (the
  // passcode screen) and makes it inactive on iOS, neither of which is the user leaving the app.
  const authenticating = useRef(false)
  // { result } for the prompt on screen, so a second request joins it instead of starting another
  const prompt = useRef(null)
  const backgroundedAt = useRef(null)
  const current = lockKey && lock?.key === lockKey ? lock : null
  const latest = useRef({ current })

  useEffect(() => {
    latest.current = { current }
  })

  useEffect(() => {
    if (!lockKey) return

    let cancelled = false
    Promise.all([getDeviceSecurity(), readUnlockChoice(userId)]).then(([device, choice]) => {
      if (cancelled) return

      // Until the user chooses, it is on when Face ID or a fingerprint is enrolled
      const enabled = device !== null && (choice ?? device.biometric)
      setLock({ key: lockKey, userId, device, enabled, locked: enabled && !signedInWithPassword })

      // Offered once per account, straight after signing in with the password
      if (signedInWithPassword && device?.biometric && choice === null) {
        offerBiometricUnlock(lockKey, userId, setLock)
      }
    })
    return () => {
      cancelled = true
    }
    // lockKey already covers userId and signedInWithPassword
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockKey])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (authenticating.current) return
      const lockState = latest.current.current
      const watching = lockState?.enabled && !lockState.locked

      if (state === 'background') {
        if (!watching) return
        setCovered(true)
        backgroundedAt.current ??= Date.now()
        return
      }
      if (state !== 'active') return

      const away = backgroundedAt.current
      backgroundedAt.current = null
      if (!watching || away === null || Date.now() - away < LOCK_AFTER_MS) {
        setCovered(false)
        return
      }

      // Checked again in case Face ID, the fingerprints or the passcode were removed meanwhile.
      // The cover stays up until then.
      getDeviceSecurity().then((device) => {
        setLock((previous) =>
          previous?.key === lockState.key ? { ...previous, device, locked: device !== null } : previous,
        )
        setCovered(false)
      })
    })
    return () => subscription.remove()
  }, [])

  // Shows the system prompt and resolves to { success, error }, within PROMPT_TIMEOUT_MS at most
  // (error 'timeout'). Only one prompt at a time: a second caller, such as the lock screen mounting
  // while a prompt is already up, gets the same result rather than a second prompt. onSuccess runs
  // whenever the prompt succeeds, even after the timeout has given up on it.
  const confirm = useCallback((promptMessage, onSuccess) => {
    if (prompt.current) return prompt.current.result

    const entry = {}
    prompt.current = entry
    authenticating.current = true
    // A prompt that timed out mustn't release a newer one
    function release() {
      if (prompt.current !== entry) return
      prompt.current = null
      authenticating.current = false
    }

    const answered = confirmDeviceOwner(promptMessage).then((result) => {
      release()
      if (result.success) onSuccess?.()
      return result
    })
    let timer
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => {
        release()
        cancelDeviceOwnerPrompt()
        resolve({ success: false, error: 'timeout' })
      }, PROMPT_TIMEOUT_MS)
    })
    entry.result = Promise.race([answered, timedOut]).finally(() => clearTimeout(timer))
    return entry.result
  }, [])

  // Resolves to the result of the prompt; the lock screen goes away on success. Unlocks the lock
  // this render belongs to (not one read from a ref, which isn't updated yet when the lock screen
  // starts its prompt on mount).
  const unlock = useCallback(
    () =>
      confirm('Unlock Niah Biodiversity', () => {
        setLock((previous) => (previous?.key === lockKey ? { ...previous, locked: false } : previous))
      }),
    [confirm, lockKey],
  )

  // For the Settings switch. Turning it off needs Face ID, a fingerprint or the passcode first.
  // Resolves to an error message, or null once saved.
  const setUnlockEnabled = useCallback(
    async (enabled) => {
      const lockState = current
      if (!lockState) return 'Please try again in a moment.'

      if (!enabled) {
        const result = await confirm(`Turn off ${UNLOCK_METHOD_NAME} unlock`)
        if (!result.success) return `Confirm it's you to turn off ${UNLOCK_METHOD_NAME} unlock.`
      }

      try {
        await saveUnlockChoice(lockState.userId, enabled)
      } catch (error) {
        console.error('Could not save the biometric unlock setting:', error)
        return 'The setting could not be saved. Please try again.'
      }
      setLock((previous) => (previous?.key === lockState.key ? { ...previous, enabled } : previous))
      return null
    },
    [confirm, current],
  )

  const value = {
    // 'checking' while the setting loads for a newly signed-in user, then 'locked' or 'unlocked'.
    // Always 'unlocked' for guests and while signed out.
    status: !lockKey ? 'unlocked' : !current ? 'checking' : current.locked ? 'locked' : 'unlocked',
    covered,
    // Whether this phone has biometrics or a passcode, so the Settings switch can work
    available: Boolean(current?.device),
    enabled: Boolean(current?.enabled),
    unlock,
    setUnlockEnabled,
  }

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
}

export function useAppLock() {
  const context = useContext(AppLockContext)
  if (!context) {
    throw new Error('useAppLock must be used inside an AppLockProvider')
  }
  return context
}

function offerBiometricUnlock(key, userId, setLock) {
  function choose(enabled) {
    saveUnlockChoice(userId, enabled).catch((error) => {
      console.error('Could not save the biometric unlock setting:', error)
    })
    setLock((previous) => (previous?.key === key ? { ...previous, enabled } : previous))
  }

  Alert.alert(
    `Use ${UNLOCK_METHOD_NAME} to unlock the app?`,
    'The app will ask for it when it opens and when you come back after 5 minutes away. You can change this in Settings.',
    [
      { text: 'Not now', style: 'cancel', onPress: () => choose(false) },
      { text: `Use ${UNLOCK_METHOD_NAME}`, onPress: () => choose(true) },
    ],
    // Android: tapping outside doesn't dismiss it without a choice
    { cancelable: false },
  )
}
