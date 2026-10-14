import { createBrowserRouter } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RoleHomeRedirect from './components/RoleHomeRedirect'
import AuthLayout from './layouts/AuthLayout'
import AppLayout from './layouts/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import SpeciesList from './pages/SpeciesList'
import SpeciesDetail from './pages/SpeciesDetail'
import SpeciesForm from './pages/SpeciesForm'
import PlantReview from './pages/PlantReview'
import SensorDashboard from './pages/SensorDashboard'
import UserManagement from './pages/UserManagement'

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [{ path: '/login', element: <Login /> }],
  },
  {
    // Every page below needs a signed-in conservation officer or admin
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <RoleHomeRedirect /> },
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/species', element: <SpeciesList /> },
      { path: '/species/new', element: <SpeciesForm /> },
      { path: '/species/:id', element: <SpeciesDetail /> },
      { path: '/species/:id/edit', element: <SpeciesForm /> },
      { path: '/review', element: <PlantReview /> },
      { path: '/sensors', element: <SensorDashboard /> },
      { path: '/users', element: <UserManagement /> },
    ],
  },
])
