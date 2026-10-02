import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

// Sends a signed-in user to their role's home page. Only rendered inside ProtectedRoute, so the
// role always has a web home here.
export default function RoleHomeRedirect() {
  const { role } = useAuth()
  return <Navigate to={homePathByRole[role]} replace />
}
