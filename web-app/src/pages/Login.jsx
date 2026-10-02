import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

export default function Login() {
  const { role, isLoading, error, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  // Signed in with web access: go back to the page they were sent here from, or their home
  const home = homePathByRole[role]
  if (home) {
    const from = location.state?.from
    return <Navigate to={from ? `${from.pathname}${from.search}` : home} replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    const trimmedEmail = email.trim()
    const errors = {
      email: trimmedEmail ? null : 'Enter your email address.',
      password: password ? null : 'Enter your password.',
    }
    setFieldErrors(errors)
    if (errors.email || errors.password) return

    setSubmitting(true)
    try {
      // On success this page redirects once the user's role has loaded
      await signIn(trimmedEmail, password)
    } finally {
      setSubmitting(false)
    }
  }

  // Also busy while a restored or new session's role is still loading
  const busy = submitting || isLoading

  return (
    <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate>
      <Typography variant="h2">Staff sign in</Typography>
      <Typography variant="body2" color="text.secondary">
        For conservation officers and admins.
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={Boolean(fieldErrors.email)}
        helperText={fieldErrors.email}
        disabled={busy}
        autoFocus
        fullWidth
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={Boolean(fieldErrors.password)}
        helperText={fieldErrors.password}
        disabled={busy}
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" loading={busy} fullWidth>
        Sign in
      </Button>
    </Stack>
  )
}
