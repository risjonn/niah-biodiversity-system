import { lazy } from 'react'

// The signed-in pages for router.jsx, each in its own chunk that downloads the first time the page
// is opened. AppLayout shows PageLoader meanwhile. Login isn't here: it stays in the main bundle
// so the entry page needs no extra request. Kept out of router.jsx because a file that declares
// components should only export components (react-refresh lint rule).
export const Dashboard = lazy(() => import('./pages/Dashboard'))
export const SpeciesList = lazy(() => import('./pages/SpeciesList'))
export const SpeciesDetail = lazy(() => import('./pages/SpeciesDetail'))
export const SpeciesForm = lazy(() => import('./pages/SpeciesForm'))
export const PlantReview = lazy(() => import('./pages/PlantReview'))
export const SensorDashboard = lazy(() => import('./pages/SensorDashboard'))
export const Reports = lazy(() => import('./pages/Reports'))
export const UserManagement = lazy(() => import('./pages/UserManagement'))
