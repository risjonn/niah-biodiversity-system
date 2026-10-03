import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { usePlants } from '../hooks/usePlants'

export default function PlantReview() {
  return (
    <Stack spacing={3}>
      <div>Plant review — coming soon</div>
      <TemporaryReviewTest />
    </Stack>
  )
}

// TEMPORARY (issue #4): checks usePlants().fetchPendingPlants and reviewPlant end to end. Remove
// this component, TemporaryReviewRow and their use above once #15 builds the real review queue.
function TemporaryReviewTest() {
  const { fetchPendingPlants } = usePlants()
  const [result, setResult] = useState(null)

  const loadPending = useCallback(
    () => fetchPendingPlants().then(setResult),
    [fetchPendingPlants],
  )

  useEffect(() => {
    let cancelled = false
    fetchPendingPlants().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchPendingPlants])

  return (
    <Stack spacing={2}>
      <Typography variant="h3">Test: fetchPendingPlants() / reviewPlant() (issue #4, temporary)</Typography>
      {!result ? <CircularProgress size={24} /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result?.data.length === 0 && !result.error ? (
        <Typography variant="body2" color="text.secondary">
          No records waiting for review.
        </Typography>
      ) : null}
      {result?.data.map((plant) => (
        <TemporaryReviewRow key={plant.id} plant={plant} onReviewed={loadPending} />
      ))}
    </Stack>
  )
}

// TEMPORARY (issue #4): remove with TemporaryReviewTest
function TemporaryReviewRow({ plant, onReviewed }) {
  const { user } = useAuth()
  const { reviewPlant } = usePlants()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Row-level security stops anyone reviewing their own record (004_prevent_self_review.sql), so
  // explain that up front. reviewPlant's error still covers anything else the database refuses.
  const isOwnRecord = Boolean(user) && plant.recorded_by === user.id

  async function handleReview(status) {
    if (submitting || isOwnRecord) return
    setSubmitting(true)
    const { error: reviewError } = await reviewPlant(plant.id, { status, rejectionReason: reason })
    setSubmitting(false)
    setError(reviewError)
    // The record leaves the pending list once reviewed
    if (!reviewError) onReviewed()
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="body1">
          {plant.qr_code} · {plant.species?.scientific_name ?? 'Unknown species'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Recorded {new Date(plant.recorded_at).toLocaleString()} · {plant.latitude},{' '}
          {plant.longitude}
          {plant.location_description ? ` · ${plant.location_description}` : ''}
        </Typography>
        {isOwnRecord ? (
          <Alert severity="info">
            You submitted this record, another officer or admin needs to review it.
          </Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            label="Rejection reason"
            size="small"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting || isOwnRecord}
            sx={{ flexGrow: 1 }}
          />
          <Button
            variant="contained"
            color="success"
            loading={submitting}
            disabled={isOwnRecord}
            onClick={() => handleReview('approved')}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            color="error"
            loading={submitting}
            disabled={isOwnRecord}
            onClick={() => handleReview('rejected')}
          >
            Reject
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
