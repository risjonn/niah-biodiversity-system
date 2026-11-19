import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined'

// Where each role lands after signing in. Botanists have no entry because they use the mobile app
// only, so any role missing from this map has no access to the web dashboard.
export const homePathByRole = {
  conservation_officer: '/dashboard',
  admin: '/dashboard',
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
