import { Outlet } from 'react-router-dom'
import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { roleLabels } from '../lib/roles'

export default function AppLayout() {
  const { fullName, role, signOut } = useAuth()

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h3" component="div" sx={{ flexGrow: 1 }}>
            Niah Biodiversity
          </Typography>
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
