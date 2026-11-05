import { useRef, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import { useAuth } from '../context/AuthContext'

const MIN_PASSWORD_LENGTH = 8

// Passwords are compared as typed, not trimmed: a space can be part of a password
function validate({ current, next, confirm }) {
  const errors = {
    current: current ? null : 'Enter your current password.',
    next: null,
    confirm: null,
  }

  if (!next) errors.next = 'Enter a new password.'
  else if (next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (!confirm) errors.confirm = 'Confirm your new password.'
  else if (confirm !== next) errors.confirm = 'New passwords do not match.'

  return errors
}

// Mount only while open, so the fields start empty each time. Stays open if the request fails, so
// the user can correct what they typed.
export default function ChangePasswordDialog({ onChanged, onClose }) {
  const { changePassword } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [busy, setBusy] = useState(false)
  const currentRef = useRef(null)

  const setField = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    const errors = validate(form)
    setFieldErrors(errors)
    setSubmitError(null)
    if (errors.current || errors.next || errors.confirm) return

    setBusy(true)
    const { error } = await changePassword(form.current, form.next)
    setBusy(false)

    if (error) setSubmitError(error)
    else onChanged()
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{
        paper: { component: 'form', onSubmit: handleSubmit, noValidate: true },
        // Not autoFocus: the menu that opens this dialog hands focus back to its button as it
        // closes, which would take it away from the field again
        transition: { onEntered: () => currentRef.current?.focus() },
      }}
    >
      <DialogTitle>Change password</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={setField('current')}
            error={Boolean(fieldErrors.current)}
            helperText={fieldErrors.current}
            disabled={busy}
            inputRef={currentRef}
            fullWidth
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.next}
            onChange={setField('next')}
            error={Boolean(fieldErrors.next)}
            helperText={fieldErrors.next}
            disabled={busy}
            fullWidth
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={setField('confirm')}
            error={Boolean(fieldErrors.confirm)}
            helperText={fieldErrors.confirm}
            disabled={busy}
            fullWidth
          />
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          Change password
        </Button>
      </DialogActions>
    </Dialog>
  )
}
