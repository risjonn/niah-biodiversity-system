import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { useSpecies } from '../hooks/useSpecies'
import { usePlants } from '../hooks/usePlants'
import { useUsers } from '../hooks/useUsers'
import { roleLabels } from '../lib/roles'

export default function Dashboard() {
  const { fullName, role } = useAuth()
  const { countSpecies } = useSpecies()
  const { countPendingPlants, countApprovedPlants } = usePlants()
  const { countUsers } = useUsers()

  return (
    <Stack spacing={4}>
      <Stack spacing={0.5}>
        <Typography variant="h1">{fullName ? `Welcome, ${fullName}` : 'Welcome'}</Typography>
        <Typography variant="body1" color="text.secondary">
          Signed in as {roleLabels[role]}
        </Typography>
      </Stack>

      <Grid container spacing={3}>
        <CountCard title="Pending reviews" to="/review" loadCount={countPendingPlants} />
        <CountCard title="Species" to="/species" loadCount={countSpecies} />
        <CountCard title="Approved plants" to="/species" loadCount={countApprovedPlants} />
        {role === 'admin' && (
          <CountCard title="Users" to="/users" loadCount={countUsers} />
        )}
      </Grid>
    </Stack>
  )
}

// A clickable card showing one total. Each card loads on its own, so a slow or failed count
// doesn't hold up the others.
function CountCard({ title, to, loadCount }) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadCount().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [loadCount])

  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h3" component="h2">
                {title}
              </Typography>
              {!result ? <CircularProgress size={24} aria-label={`Loading ${title}`} /> : null}
              {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
              {result && !result.error ? (
                <Typography variant="h1" component="p">
                  {result.data.toLocaleString()}
                </Typography>
              ) : null}
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>
    </Grid>
  )
}