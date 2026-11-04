import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Box, CircularProgress } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

export default function ProtectedRoute({ children, allowedRoles }) {
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
    return <Navigate to="/login" replace state={{ from: location }} />
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