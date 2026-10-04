import { NavLink, Outlet } from 'react-router-dom'
import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { roleLabels } from '../lib/roles'

// Paths match router.jsx. A link stays highlighted on the pages below it, so Species is still
// highlighted on a species detail page (/species/:id).
const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/species', label: 'Species' },
  { to: '/review', label: 'Plant review' },
  { to: '/sensors', label: 'Sensors' },
  { to: '/users', label: 'Users', adminOnly: true },
]

export default function AppLayout() {
  const { fullName, role, signOut } = useAuth()
  const links = NAV_LINKS.filter((link) => !link.adminOnly || role === 'admin')

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
          <Typography variant="h3" component="div">
            Niah Biodiversity
          </Typography>
          <Box
            component="nav"
            aria-label="Main"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, flexGrow: 1 }}
          >
            {links.map((link) => (
              // NavLink adds the "active" class (and aria-current="page") on the current route
              <Button
                key={link.to}
                component={NavLink}
                to={link.to}
                color="inherit"
                sx={{ '&.active, &.active:hover': { bgcolor: 'primary.dark' } }}
              >
                {link.label}
              </Button>
            ))}
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2">{fullName}</Typography>
            <Typography variant="caption">{roleLabels[role]}</Typography>
          </Box>
          <Button color="inherit" variant="outlined" onClick={signOut}>
            Log out
          </Button>
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
