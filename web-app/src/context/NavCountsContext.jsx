import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlants } from '../hooks/usePlants'
import { useSensors } from '../hooks/useSensors'

const NavCountsContext = createContext(null)

// The sidebar's badge counts: pending reviews for the signed-in user (the same total as the
// dashboard card) and open alerts. Reloaded on every route change, and by pages straight after
// something that changes them (approve/reject) through refreshCounts. The sensors page sets the
// open alerts count itself, from the list it has just loaded (setOpenAlertsCount), so the badge
// and that list always match.
// A count is null while unknown or if it failed to load; the badge is hidden then, as at 0.
export function NavCountsProvider({ children }) {
  const { countPendingReviews } = usePlants()
  const { countOpenAlerts } = useSensors()
  const { pathname } = useLocation()
  const [counts, setCounts] = useState({ pendingReviews: null, openAlerts: null })
  // Bumped whenever a count is asked for or set. An answer only applies if its count hasn't been
  // asked for or set since, so a slow earlier request can never overwrite a newer value.
  const versions = useRef({ pendingReviews: 0, openAlerts: 0 })

  const refreshCounts = useCallback(async () => {
    const asked = {
      pendingReviews: ++versions.current.pendingReviews,
      openAlerts: ++versions.current.openAlerts,
    }
    const [reviews, alerts] = await Promise.all([countPendingReviews(), countOpenAlerts()])
    const reviewsCurrent = versions.current.pendingReviews === asked.pendingReviews
    const alertsCurrent = versions.current.openAlerts === asked.openAlerts
    if (!reviewsCurrent && !alertsCurrent) return
    setCounts((current) => ({
      pendingReviews: reviewsCurrent ? (reviews.error ? null : reviews.data) : current.pendingReviews,
      openAlerts: alertsCurrent ? (alerts.error ? null : alerts.data) : current.openAlerts,
    }))
  }, [countPendingReviews, countOpenAlerts])

  const setOpenAlertsCount = useCallback((count) => {
    versions.current.openAlerts += 1
    setCounts((current) => ({ ...current, openAlerts: count }))
  }, [])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts, pathname])

  // Nothing left to apply a late answer to once the provider is gone
  useEffect(() => {
    const current = versions.current
    return () => {
      current.pendingReviews += 1
      current.openAlerts += 1
    }
  }, [])

  const value = useMemo(
    () => ({ counts, refreshCounts, setOpenAlertsCount }),
    [counts, refreshCounts, setOpenAlertsCount],
  )
  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>
}

// Same pattern as useAuth in AuthContext.jsx
// eslint-disable-next-line react-refresh/only-export-components
export function useNavCounts() {
  const context = useContext(NavCountsContext)
  if (!context) throw new Error('useNavCounts must be used inside NavCountsProvider')
  return context
}
