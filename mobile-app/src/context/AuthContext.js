import { createContext, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

// Matches the user_role enum in database/schema/001_initial_schema.sql
const ROLES = ['botanist', 'conservation_officer', 'admin']

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined until Supabase has finished restoring any saved session
  const [session, setSession] = useState(undefined)
  // Kept with the user it was loaded for, so one user's role never carries over to the next
  const [loadedRole, setLoadedRole] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Fires INITIAL_SESSION straight away with the saved session (or null), then again on
    // every sign-in, sign-out and token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setLoadedRole(null)
    })
    return () => subscription.unsubscribe()
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

  const userId = session?.user.id ?? null

  // Looked up here rather than inside the onAuthStateChange callback, which Supabase asks to keep
  // quick because a slow callback holds up every later auth event
  useEffect(() => {
    if (!userId) return

    let cancelled = false
    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return

        const role = ROLES.includes(data?.role) ? data.role : null
        setLoadedRole({ userId, role })
        if (role) {
          setError(null)
          return
        }

        // Without a role there is nowhere to route the user, so sign them back out
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
  }, [userId])

  async function signIn(email, password) {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInErrorMessage(signInError))
  }

  // Only signs out this device; any other devices the user is signed in on stay signed in
  function signOut() {
    return supabase.auth.signOut({ scope: 'local' })
  }

  const roleLoaded = loadedRole?.userId === userId

  const value = {
    user: session?.user ?? null,
    role: roleLoaded ? loadedRole.role : null,
    // True until we know whether anyone is signed in and, if so, what their role is
    isLoading: session === undefined || (userId !== null && !roleLoaded),
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

function signInErrorMessage(error) {
  if (isAuthRetryableFetchError(error)) {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  if (isAuthApiError(error) && error.code === 'invalid_credentials') {
    return 'Incorrect email or password.'
  }
  return error.message
}
