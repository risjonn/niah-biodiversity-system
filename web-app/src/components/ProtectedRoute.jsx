import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Box, CircularProgress } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

export default function ProtectedRoute({ children }) {
  const { user, role, isLoading, error } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  if (!user) {
    // Remember where they were heading so the login page can send them back there
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Botanists have no web home. AuthContext is already signing them out, after which this
  // redirects to the login page; until then, never render any part of the app for them.
  if (!homePathByRole[role]) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error ?? 'You do not have access to this dashboard.'}</Alert>
      </Box>
    )
  }

  return children
}
