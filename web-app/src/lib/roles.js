import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined'

// Where each role lands after signing in. Botanists have no entry because they use the mobile app
// only, so any role missing from this map has no access to the web dashboard.
export const homePathByRole = {
  conservation_officer: '/dashboard',
  admin: '/dashboard',
}

// Pages only some of those roles may open, with the page's sub-paths. Every other page is open to
// every role in homePathByRole. Used by the router and by the login page's return-to check.
export const pageRolesByPath = {
  '/users': ['admin'],
}

// Whether `role` may open `pathname`, e.g. false for a conservation officer and /users
export function canOpenPath(role, pathname) {
  if (!homePathByRole[role]) return false
  const restricted = Object.entries(pageRolesByPath).find(
    ([path]) => pathname === path || pathname.startsWith(`${path}/`),
  )
  return !restricted || restricted[1].includes(role)
}

// Where the login page sends a user who has just signed in: back to `from`, the page a signed-out
// visitor opened directly, when their role may see it, otherwise their home page
export function signInDestination(role, from) {
  if (from && canOpenPath(role, from.pathname)) return `${from.pathname}${from.search ?? ''}`
  return homePathByRole[role]
}

// An icon for each role, for the role chips on the Users page
export const roleIcons = {
  botanist: LocalFloristOutlinedIcon,
  conservation_officer: VerifiedUserOutlinedIcon,
  admin: AdminPanelSettingsOutlinedIcon,
}

export const roleLabels = {
  botanist: 'Botanist',
  conservation_officer: 'Conservation officer',
  admin: 'Admin',
}
