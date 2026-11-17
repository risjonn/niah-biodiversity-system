import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  Alert,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useAuth } from '../context/AuthContext'
import { homePathByRole } from '../lib/roles'

export default function Login() {
  const { role, isLoading, error, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)

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

  // Checked on key down and up, so pressing Caps Lock itself updates the hint straight away
  function updateCapsLock(event) {
    setCapsLockOn(event.getModifierState?.('CapsLock') ?? false)
  }

  return (
    <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate>
      <Typography variant="h2">Staff sign in</Typography>
      <Typography variant="body2" color="textSecondary">
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
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onKeyDown={updateCapsLock}
        onKeyUp={updateCapsLock}
        onBlur={() => setCapsLockOn(false)}
        error={Boolean(fieldErrors.password)}
        // A validation error takes the helper text's place over the Caps Lock hint
        helperText={fieldErrors.password ?? (capsLockOn ? 'Caps Lock is on.' : null)}
        disabled={busy}
        fullWidth
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((shown) => !shown)}
                  // Keeps focus in the field, so typing can carry on after toggling
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={busy}
                  edge="end"
                >
                  {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      {/* Spinner before the label while busy. "Signing in…" only for a sign-in the user started,
          not while a restored session is loading. */}
      <Button
        type="submit"
        variant="contained"
        size="large"
        loading={busy}
        loadingPosition="start"
        fullWidth
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <Typography variant="body2" color="textSecondary">
        Accounts are created by an admin. Ask your admin if you need access.
      </Typography>
    </Stack>
  )
}
