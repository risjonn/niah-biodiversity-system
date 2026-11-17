import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Avatar,
  Box,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Badge,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined'
import QrCode2OutlinedIcon from '@mui/icons-material/QrCode2Outlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import ContourPattern from './ContourPattern'
import { useAuth } from '../context/AuthContext'
import { useNavCounts } from '../context/NavCountsContext'
import { roleLabels } from '../lib/roles'
import { visuallyHidden } from '../lib/visuallyHidden'
import { tokens } from '../theme/theme'

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_RAIL_WIDTH = 72

// Paths match router.jsx. A link stays highlighted on the pages below it, so Species is still
// highlighted on a species detail page (/species/:id). `count` names the badge count, if any.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: DashboardOutlinedIcon },
  { to: '/species', label: 'Species', icon: LocalFloristOutlinedIcon },
  { to: '/records', label: 'Plant records', icon: QrCode2OutlinedIcon },
  {
    to: '/review',
    label: 'Plant review',
    icon: FactCheckOutlinedIcon,
    count: { key: 'pendingReviews', color: 'warning', noun: ['pending review', 'pending reviews'] },
  },
  {
    to: '/sensors',
    label: 'Sensors',
    icon: SensorsOutlinedIcon,
    count: { key: 'openAlerts', color: 'error', noun: ['open alert', 'open alerts'] },
  },
  { to: '/reports', label: 'Reports', icon: AssessmentOutlinedIcon },
  { to: '/users', label: 'Users', icon: PeopleOutlinedIcon, adminOnly: true },
]

// The sidebar's contents, for both the permanent drawer (md and up) and the temporary one below.
// - collapsed: the icon rail, labels shown as tooltips
// - onToggleCollapsed: shows the collapse button (permanent drawer only)
// - onNavigate: called when a link is followed, so the temporary drawer can close
export default function AppSidebar({ collapsed = false, onToggleCollapsed, onNavigate, onChangePassword }) {
  const { role } = useAuth()
  const { counts } = useNavCounts()
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SidebarHeader collapsed={collapsed} />

      <List component="nav" aria-label="Main" sx={{ px: 1, py: 2 }}>
        {items.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            count={item.count ? counts[item.count.key] : null}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </List>

      <Box sx={{ flexGrow: 1 }} />

      {onToggleCollapsed ? (
        <List sx={{ px: 1, py: 0 }}>
          <SidebarButton
            collapsed={collapsed}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? KeyboardDoubleArrowRightIcon : KeyboardDoubleArrowLeftIcon}
            onClick={onToggleCollapsed}
          />
        </List>
      ) : null}
      <Divider sx={{ mt: 1 }} />
      <UserCard collapsed={collapsed} onChangePassword={onChangePassword} />
    </Box>
  )
}

// The product name on the contour pattern, or just "N" on the rail
function SidebarHeader({ collapsed }) {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        px: collapsed ? 0 : 2.5,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
      }}
    >
      <ContourPattern />
      <Typography variant="h3" component="div" noWrap sx={{ position: 'relative', fontWeight: 600 }}>
        {collapsed ? (
          <>
            <span aria-hidden="true">N</span>
            <Box component="span" sx={visuallyHidden}>
              Niah Biodiversity
            </Box>
          </>
        ) : (
          'Niah Biodiversity'
        )}
      </Typography>
    </Box>
  )
}

// Shared look for the rows: the nav links and the collapse button
function rowSx(collapsed) {
  return {
    position: 'relative',
    minHeight: 44,
    borderRadius: 1,
    mb: 0.5,
    px: collapsed ? 0 : 1.5,
    justifyContent: collapsed ? 'center' : 'flex-start',
    color: 'text.secondary',
    '& .MuiListItemIcon-root': {
      minWidth: 0,
      mr: collapsed ? 0 : 2,
      color: 'inherit',
      justifyContent: 'center',
    },
  }
}

function NavItem({ item, count, collapsed, onNavigate }) {
  const Icon = item.icon
  const showCount = Boolean(item.count && count > 0)
  const countText = showCount
    ? `${count} ${count === 1 ? item.count.noun[0] : item.count.noun[1]}`
    : null

  const link = (
    <ListItemButton
      component={NavLink}
      to={item.to}
      onClick={onNavigate}
      // On the rail the label isn't shown, so it (and the count) is the link's name
      aria-label={collapsed ? [item.label, countText].filter(Boolean).join(', ') : undefined}
      sx={[
        rowSx(collapsed),
        {
          // NavLink adds "active" (and aria-current="page") on the current route
          '&.active': {
            bgcolor: alpha(tokens.primary, 0.1),
            color: 'primary.dark',
            '& .MuiListItemText-primary': { fontWeight: 600 },
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: 1,
              bgcolor: 'primary.main',
            },
          },
          '&.active:hover': { bgcolor: alpha(tokens.primary, 0.14) },
        },
      ]}
    >
      <ListItemIcon>
        {collapsed ? (
          <Badge badgeContent={showCount ? count : 0} color={item.count?.color} max={99}>
            <Icon />
          </Badge>
        ) : (
          <Icon />
        )}
      </ListItemIcon>
      {collapsed ? null : (
        <>
          <ListItemText primary={item.label} slotProps={{ primary: { noWrap: true } }} />
          {showCount ? (
            <Chip
              size="small"
              color={item.count.color}
              label={
                <>
                  {count > 99 ? '99+' : count}
                  <Box component="span" sx={visuallyHidden}>
                    {' '}
                    {count === 1 ? item.count.noun[0] : item.count.noun[1]}
                  </Box>
                </>
              }
              sx={{ ml: 1, height: 20, fontWeight: 600 }}
            />
          ) : null}
        </>
      )}
    </ListItemButton>
  )

  return collapsed ? (
    <Tooltip title={item.label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

function SidebarButton({ collapsed, label, icon: Icon, onClick }) {
  const button = (
    <ListItemButton onClick={onClick} aria-label={label} sx={rowSx(collapsed)}>
      <ListItemIcon>
        <Icon />
      </ListItemIcon>
      {collapsed ? null : <ListItemText primary={label} slotProps={{ primary: { noWrap: true } }} />}
    </ListItemButton>
  )
  return collapsed ? (
    <Tooltip title={label} placement="right">
      {button}
    </Tooltip>
  ) : (
    button
  )
}

// "Siti Nurhaliza" -> "SN", "Daniel" -> "D". The role's first letter when there's no name.
function initialsOf(name, role) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return (roleLabels[role] ?? '?').charAt(0)
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words.at(-1).charAt(0) : ''
  return (first + last).toUpperCase()
}

// The signed-in user at the bottom of the sidebar. Opens a menu with Change password and Log out.
function UserCard({ collapsed, onChangePassword }) {
  const { fullName, role, signOut } = useAuth()
  const [anchor, setAnchor] = useState(null)
  const roleLabel = roleLabels[role]

  const button = (
    <ListItemButton
      id="user-menu-button"
      aria-haspopup="true"
      aria-controls={anchor ? 'user-menu' : undefined}
      aria-expanded={anchor ? 'true' : undefined}
      // On the rail only the avatar shows, so the button needs a name of its own
      aria-label={collapsed ? `Account: ${[fullName, roleLabel].filter(Boolean).join(', ')}` : undefined}
      onClick={(event) => setAnchor(event.currentTarget)}
      sx={{
        borderRadius: 1,
        px: collapsed ? 0 : 1,
        py: 1,
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 1.5,
      }}
    >
      <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', typography: 'body2', fontWeight: 600 }}>
        {initialsOf(fullName, role)}
      </Avatar>
      {collapsed ? null : (
        <>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {fullName}
            </Typography>
            <Typography variant="caption" component="div" color="textSecondary" noWrap>
              {roleLabel}
            </Typography>
          </Box>
          <UnfoldMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden="true" />
        </>
      )}
    </ListItemButton>
  )

  return (
    <Box sx={{ p: 1 }}>
      {collapsed ? (
        <Tooltip title={fullName ?? roleLabel ?? 'Account'} placement="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <Menu
        id="user-menu"
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        // Opens upwards, since the card is at the bottom of the screen
        anchorOrigin={{ vertical: 'top', horizontal: collapsed ? 'right' : 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ list: { 'aria-labelledby': 'user-menu-button' } }}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onChangePassword()
          }}
        >
          Change password
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            signOut()
          }}
        >
          Log out
        </MenuItem>
      </Menu>
    </Box>
  )
}
