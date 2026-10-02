import { createContext, useContext, useEffect, useState } from 'react'
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { homePathByRole } from '../lib/roles'

// Matches the user_role enum in database/schema/001_initial_schema.sql
const ROLES = ['botanist', 'conservation_officer', 'admin']

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined until Supabase has finished restoring any saved session
  const [session, setSession] = useState(undefined)
  // Kept with the user it was loaded for, so one user's profile never carries over to the next
  const [loadedProfile, setLoadedProfile] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Fires INITIAL_SESSION straight away with the saved session (or null), then again on
    // every sign-in, sign-out and token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setLoadedProfile(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  // Looked up here rather than inside the onAuthStateChange callback, which Supabase asks to keep
  // quick because a slow callback holds up every later auth event
  useEffect(() => {
    if (!userId) return

    let cancelled = false
    supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return

        const role = ROLES.includes(data?.role) ? data.role : null
        setLoadedProfile({ userId, role, fullName: data?.full_name ?? null })
        if (homePathByRole[role]) {
          setError(null)
          return
        }

        // Checked here rather than only in ProtectedRoute because signing in happens on the
        // login page, outside any protected route. Botanists (and accounts without a role)
        // are signed straight back out, and the reason is shown on the login page.
        if (role) {
          setError(
            'This dashboard is for conservation officers and admins. Botanists should use the Niah Biodiversity mobile app.',
          )
        } else if (queryError) {
          setError('Your account could not be loaded. Check your connection and try again.')
        } else {
          setError('This account has no role assigned yet. Ask an administrator to set one up.')
        }
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

  // Only signs out this browser; any other devices the user is signed in on stay signed in
  function signOut() {
    return supabase.auth.signOut({ scope: 'local' })
  }

  const profileLoaded = loadedProfile?.userId === userId

  const value = {
    user: session?.user ?? null,
    role: profileLoaded ? loadedProfile.role : null,
    fullName: profileLoaded ? loadedProfile.fullName : null,
    // True until we know whether anyone is signed in and, if so, what their role is
    isLoading: session === undefined || (userId !== null && !profileLoaded),
    // Why the last sign-in attempt failed, or why the user was signed out
    error,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
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
