import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Box, CircularProgress } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, isLoading, error, signedInThisVisit } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  if (!user) {
    // A signed-out visitor who opened this page directly (a deep link) comes back to it after
    // signing in. Once someone has been signed in on this page load, getting here means they
    // signed out, so no page is passed on: the next person to sign in starts at their home.
    // The replace also drops any `from` the current history entry had.
    const state = signedInThisVisit ? undefined : { from: location }
    return <Navigate to="/login" replace state={state} />
  }

  if (!homePathByRole[role]) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          {error ?? 'You do not have access to this dashboard.'}
        </Alert>
      </Box>
    )
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />
  }

  return children
}