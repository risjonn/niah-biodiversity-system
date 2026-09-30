import { createBrowserRouter } from 'react-router-dom'
import Login from './pages/Login'
import SpeciesList from './pages/SpeciesList'
import SpeciesDetail from './pages/SpeciesDetail'
import PlantReview from './pages/PlantReview'
import SensorDashboard from './pages/SensorDashboard'
import UserManagement from './pages/UserManagement'

export const router = createBrowserRouter([
  { path: '/', element: <SpeciesList /> },
  { path: '/species/:id', element: <SpeciesDetail /> },
  { path: '/login', element: <Login /> },
  { path: '/review', element: <PlantReview /> },
  { path: '/sensors', element: <SensorDashboard /> },
  { path: '/users', element: <UserManagement /> },
])