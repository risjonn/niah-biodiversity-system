import { Suspense, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Typography,
} from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import MenuIcon from '@mui/icons-material/Menu'
import ChangePasswordDialog from '../components/ChangePasswordDialog'
import PageLoader from '../components/PageLoader'
import { useAuth } from '../context/AuthContext'
import { roleLabels } from '../lib/roles'

// Paths match router.jsx. A link stays highlighted on the pages below it, so Species is still
// highlighted on a species detail page (/species/:id).
const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/species', label: 'Species' },
  { to: '/review', label: 'Plant review' },
  { to: '/sensors', label: 'Sensors' },
  { to: '/reports', label: 'Reports' },
  { to: '/users', label: 'Users', adminOnly: true },
]

export default function AppLayout() {
  const { fullName, role, signOut } = useAuth()
  const links = NAV_LINKS.filter((link) => !link.adminOnly || role === 'admin')
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [navAnchor, setNavAnchor] = useState(null)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
          {/* Below md the title takes the spare width, so the user menu stays on the right */}
          <Typography variant="h3" component="div" sx={{ flexGrow: { xs: 1, md: 0 } }}>
            Niah Biodiversity
          </Typography>
          {/* Below md the links fold into a menu button, shown first in the bar */}
          <Box
            component="nav"
            aria-label="Main"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, flexGrow: { md: 1 }, order: { xs: -1, md: 0 } }}
          >
            <IconButton
              id="nav-menu-button"
              color="inherit"
              edge="start"
              aria-label="Open navigation menu"
              aria-haspopup="true"
              aria-controls={navAnchor ? 'nav-menu' : undefined}
              aria-expanded={navAnchor ? 'true' : undefined}
              onClick={(event) => setNavAnchor(event.currentTarget)}
              sx={{ display: { md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            {links.map((link) => (
              // NavLink adds the "active" class (and aria-current="page") on the current route
              <Button
                key={link.to}
                component={NavLink}
                to={link.to}
                color="inherit"
                sx={{
                  display: { xs: 'none', md: 'inline-flex' },
                  '&.active, &.active:hover': { bgcolor: 'primary.dark' },
                }}
              >
                {link.label}
              </Button>
            ))}
          </Box>
          <Menu
            id="nav-menu"
            anchorEl={navAnchor}
            open={Boolean(navAnchor)}
            onClose={() => setNavAnchor(null)}
            slotProps={{ list: { 'aria-labelledby': 'nav-menu-button' } }}
          >
            {links.map((link) => (
              <MenuItem
                key={link.to}
                component={NavLink}
                to={link.to}
                onClick={() => setNavAnchor(null)}
                // Same "active" class as the desktop links, shown in the menu's selected style
                sx={{ '&.active': { bgcolor: 'action.selected', fontWeight: 500 } }}
              >
                {link.label}
              </MenuItem>
            ))}
          </Menu>
          {/* Spans, because a button can't contain block elements. The role is part of the button so
              it still has a label for an account with no name. */}
          <Button
            id="user-menu-button"
            color="inherit"
            aria-haspopup="true"
            aria-controls={menuAnchor ? 'user-menu' : undefined}
            aria-expanded={menuAnchor ? 'true' : undefined}
            endIcon={<ArrowDropDownIcon />}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <Box component="span" sx={{ textAlign: 'right' }}>
              <Typography variant="body2" component="span" sx={{ display: 'block' }}>
                {fullName}
              </Typography>
              <Typography variant="caption" component="span" sx={{ display: 'block' }}>
                {roleLabels[role]}
              </Typography>
            </Box>
          </Button>
          <Menu
            id="user-menu"
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ list: { 'aria-labelledby': 'user-menu-button' } }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null)
                setChangePasswordOpen(true)
              }}
            >
              Change password
            </MenuItem>
          </Menu>
          <Button color="inherit" variant="outlined" onClick={signOut}>
            Log out
          </Button>
        </Toolbar>
      </AppBar>
      {/* lg on every page: no page sets its own width, so they all already used MUI's default */}
      <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </Container>

      {changePasswordOpen ? (
        <ChangePasswordDialog
          onChanged={() => {
            setChangePasswordOpen(false)
            setPasswordChanged(true)
          }}
          onClose={() => setChangePasswordOpen(false)}
        />
      ) : null}

      <Snackbar
        open={passwordChanged}
        autoHideDuration={5000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setPasswordChanged(false)
        }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setPasswordChanged(false)}
          sx={{ width: '100%' }}
        >
          Your password has been changed
        </Alert>
      </Snackbar>
    </Box>
  )
}
