import { useEffect, useState } from 'react'
import { Alert, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useSpecies } from '../hooks/useSpecies'

export default function SpeciesList() {
  return (
    <Stack spacing={3}>
      <div>Species list — coming soon</div>
      <TemporarySpeciesTest />
    </Stack>
  )
}

// TEMPORARY (issue #4): checks useSpecies().fetchSpecies end to end. Remove this component and
// its use above once #13 builds the real species list.
function TemporarySpeciesTest() {
  const { fetchSpecies } = useSpecies()
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchSpecies().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies])

  return (
    <Stack spacing={1}>
      <Typography variant="h3">Test: fetchSpecies() (issue #4, temporary)</Typography>
      {!result ? <CircularProgress size={24} /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result?.data.length === 0 && !result.error ? (
        <Typography variant="body2" color="text.secondary">
          No species found.
        </Typography>
      ) : null}
      <List dense>
        {result?.data.map((species) => (
          <ListItem key={species.id} disableGutters>
            <ListItemText
              primary={species.scientific_name}
              secondary={[species.common_name, species.family, species.conservation_status]
                .filter(Boolean)
                .join(' · ')}
            />
          </ListItem>
        ))}
      </List>
    </Stack>
  )
}
