import { createContext, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

// Matches the user_role enum in database/schema/001_initial_schema.sql
const ROLES = ['botanist', 'conservation_officer', 'admin']

// The last signed-in account and its role, so a botanist stays signed in when the app starts
// without a connection. Saved whenever the role loads and removed on sign-out.
const SAVED_ACCOUNT_KEY = 'niah-offline-account'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined until Supabase has finished restoring any saved session
  const [session, setSession] = useState(undefined)
  // Kept with the user it was loaded for, so one user's role never carries over to the next
  const [loadedRole, setLoadedRole] = useState(null)
  // { user: { id, email }, role } from the phone, used when the app started offline and Supabase
  // couldn't refresh the saved session. Replaced by the real session once the phone reconnects.
  const [offlineAccount, setOfflineAccount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true

    // Fires INITIAL_SESSION straight away with the saved session (or null), then again on
    // every sign-in, sign-out and token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION' && !nextSession) {
        // Null here can also mean a saved session whose token couldn't be refreshed offline.
        // Checked after this callback returns, since Supabase holds later auth calls until then.
        setTimeout(() => {
          restoreOfflineAccount().then((account) => {
            if (!active) return
            setOfflineAccount(account)
            // A sign-in or token refresh may have arrived meanwhile
            setSession((current) => (current === undefined ? null : current))
          })
        }, 0)
        return
      }

      if (event === 'SIGNED_OUT') {
        setOfflineAccount(null)
        forgetSavedAccount()
      }
      setSession(nextSession)
      if (!nextSession) setLoadedRole(null)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    // Tokens can only refresh while the app is running, so pause refreshing in the background
    // and resume it (refreshing straight away if needed) when the app is reopened
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    })
    return () => subscription.remove()
  }, [])

  const sessionUserId = session?.user.id ?? null
  const sessionEmail = session?.user.email ?? null

  // Looked up here rather than inside the onAuthStateChange callback, which Supabase asks to keep
  // quick because a slow callback holds up every later auth event
  useEffect(() => {
    if (!sessionUserId) return

    let cancelled = false
    supabase
      .from('profiles')
      .select('role')
      .eq('id', sessionUserId)
      .maybeSingle()
      .then(async ({ data, error: queryError }) => {
        if (cancelled) return

        const role = ROLES.includes(data?.role) ? data.role : null
        if (role) {
          setLoadedRole({ userId: sessionUserId, role })
          setOfflineAccount(null)
          setError(null)
          saveAccount({ userId: sessionUserId, email: sessionEmail, role })
          return
        }

        // The request never reached the server: carry on with the role saved the last time this
        // user was online, rather than signing them out in the field
        if (queryError && !queryError.code) {
          const saved = await readSavedAccount()
          if (cancelled) return
          if (saved?.userId === sessionUserId) {
            setLoadedRole({ userId: sessionUserId, role: saved.role })
            setError(null)
            return
          }
        }

        // Without a role there is nowhere to route the user, so sign them back out
        setLoadedRole({ userId: sessionUserId, role: null })
        setError(
          queryError
            ? 'Your account could not be loaded. Check your connection and try again.'
            : 'This account has no role assigned yet. Ask an administrator to set one up.',
        )
        supabase.auth.signOut({ scope: 'local' })
      })

    return () => {
      cancelled = true
    }
  }, [sessionUserId, sessionEmail])

  async function signIn(email, password) {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInErrorMessage(signInError))
  }

  // Only signs out this device; any other devices the user is signed in on stay signed in
  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) {
      // Offline with an expired token, Supabase can't load the session to sign out of and leaves
      // it saved, which would sign the user straight back in once the phone reconnects. So it is
      // removed from storage here instead.
      const key = supabase.auth.storageKey
      await AsyncStorage.multiRemove([key, `${key}-user`]).catch(() => {})
      setSession(null)
      setLoadedRole(null)
      setOfflineAccount(null)
    }
    await forgetSavedAccount()
  }

  const user = session?.user ?? offlineAccount?.user ?? null
  const userId = user?.id ?? null
  const roleLoaded = sessionUserId !== null && loadedRole?.userId === sessionUserId
  // Also keeps the user where they are while the role is checked again after reconnecting
  const offlineRole = offlineAccount && offlineAccount.user.id === userId ? offlineAccount.role : null

  const value = {
    user,
    role: roleLoaded ? loadedRole.role : offlineRole,
    // True until we know whether anyone is signed in and, if so, what their role is
    isLoading: session === undefined || (userId !== null && !roleLoaded && !offlineRole),
    // Why the last sign-in attempt failed, or why the user was signed out
    error,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}

// The saved account, but only if Supabase still holds a saved session that it couldn't refresh
// because the server was unreachable. After a real sign-out, or when the server rejects the
// refresh token, there is no such error and the user stays signed out.
async function restoreOfflineAccount() {
  const { error } = await supabase.auth.getSession()
  if (!error || !isAuthRetryableFetchError(error)) return null

  const saved = await readSavedAccount()
  return saved ? { user: { id: saved.userId, email: saved.email }, role: saved.role } : null
}

async function readSavedAccount() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(SAVED_ACCOUNT_KEY))
    return saved?.userId && ROLES.includes(saved.role) ? saved : null
  } catch {
    return null
  }
}

function saveAccount(account) {
  AsyncStorage.setItem(SAVED_ACCOUNT_KEY, JSON.stringify(account)).catch(() => {})
}

function forgetSavedAccount() {
  return AsyncStorage.removeItem(SAVED_ACCOUNT_KEY).catch(() => {})
}

function signInErrorMessage(error) {
  if (isAuthRetryableFetchError(error)) {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  if (isAuthApiError(error) && error.code === 'invalid_credentials') {
    return 'Incorrect email or password.'
  }
  return error.message
}
