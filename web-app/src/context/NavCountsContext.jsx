import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlants } from '../hooks/usePlants'
import { useSensors } from '../hooks/useSensors'

const NavCountsContext = createContext(null)

// The sidebar's badge counts: pending reviews for the signed-in user (the same total as the
// dashboard card) and open alerts. Reloaded on every route change, and by pages straight after
// something that changes them (approve/reject) through refreshCounts. The sensors page sets the
// open alerts count itself, from the list it has just loaded (setOpenAlertsCount), so the badge
// and that list always match. Both the sensors page and the dashboard poll (hooks/usePolling.js):
// the sensors page through setOpenAlertsCount, the dashboard through refreshOpenAlerts, so the
// badge keeps up while either is open.
// A count is null while unknown or if it failed to load; the badge is hidden then, as at 0.
// errors.<count> holds the message when it failed, so the dashboard card can tell loading from
// failed (the badge doesn't need to).
export function NavCountsProvider({ children }) {
  const { countPendingReviews } = usePlants()
  const { countOpenAlerts } = useSensors()
  const { pathname } = useLocation()
  const [counts, setCounts] = useState({
    pendingReviews: null,
    openAlerts: null,
    errors: { pendingReviews: null, openAlerts: null },
  })
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
      errors: {
        pendingReviews: reviewsCurrent ? reviews.error : current.errors.pendingReviews,
        openAlerts: alertsCurrent ? alerts.error : current.errors.openAlerts,
      },
    }))
  }, [countPendingReviews, countOpenAlerts])

  // Reloads only the open alerts count, for the dashboard's poll (usePolling), which would
  // otherwise query pending reviews every few seconds too. Unlike refreshCounts, a failure keeps
  // the last count it had, with no error, so one failed poll doesn't blank the badge and the
  // dashboard card until the next one. The error only shows while no count has loaded yet.
  const refreshOpenAlerts = useCallback(async () => {
    const asked = ++versions.current.openAlerts
    const alerts = await countOpenAlerts()
    if (versions.current.openAlerts !== asked) return
    setCounts((current) => {
      if (alerts.error && current.openAlerts != null) return current
      return {
        ...current,
        openAlerts: alerts.error ? null : alerts.data,
        errors: { ...current.errors, openAlerts: alerts.error },
      }
    })
  }, [countOpenAlerts])

  const setOpenAlertsCount = useCallback((count) => {
    versions.current.openAlerts += 1
    setCounts((current) => ({
      ...current,
      openAlerts: count,
      errors: { ...current.errors, openAlerts: null },
    }))
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
    () => ({ counts, refreshCounts, refreshOpenAlerts, setOpenAlertsCount }),
    [counts, refreshCounts, refreshOpenAlerts, setOpenAlertsCount],
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
