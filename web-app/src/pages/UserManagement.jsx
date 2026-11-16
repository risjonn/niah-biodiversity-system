import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TableSkeleton from '../components/TableSkeleton'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useUsers, userRoleLabels, userRoles } from '../hooks/useUsers'
import { formatDate } from '../lib/formatDateTime'

// The table's headings, shared with its loading skeleton
const COLUMNS = ['Name', 'Email', 'Role', 'Created']

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const { fetchUsers, createUser, updateUserRole } = useUsers()
  const [result, setResult] = useState(null)
  // Ids of users with a role change running, so their role box can't be changed twice
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  // { email, password } of the account just created, shown once for the admin to pass on
  const [tempPassword, setTempPassword] = useState(null)
  const toast = useToast()

  useEffect(() => {
    let cancelled = false
    fetchUsers().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchUsers])

  const users = result?.data ?? []

  async function handleRoleChange(user, role) {
    if (busyIds.has(user.id) || role === user.role) return

    setBusyIds((ids) => new Set(ids).add(user.id))
    const { data, error } = await updateUserRole(user.id, role)
    setBusyIds((ids) => {
      const next = new Set(ids)
      next.delete(user.id)
      return next
    })

    if (error) {
      toast.error(error)
      return
    }
    setResult((current) => ({
      ...current,
      data: current.data.map((item) => (item.id === user.id ? data : item)),
    }))
    toast.success(`${user.full_name} is now ${userRoleLabels[role]}`)
  }

  // Resolves to an error message, or null once the account is created and the dialog can close
  async function handleCreate(values) {
    const { data, error } = await createUser(values)
    if (error) return error

    setResult((current) => ({ ...current, data: [...(current?.data ?? []), data.user] }))
    setTempPassword({ email: data.user.email ?? values.email, password: data.tempPassword })
    toast.success(`Created account for ${data.user.full_name ?? values.fullName}`)
    return null
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Users"
        subtitle={
          result && !result.error
            ? users.length === 1
              ? '1 account'
              : `${users.length} accounts`
            : null
        }
        action={
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Add user
          </Button>
        }
      />

      {!result ? <TableSkeleton columns={COLUMNS} label="Loading users" /> : null}
      {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
      {result && !result.error && users.length === 0 ? (
        <EmptyState
          message="No users yet"
          action={
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              Add user
            </Button>
          }
        />
      ) : null}

      {users.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableCell key={column}>{column}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={Boolean(currentUser) && user.id === currentUser.id}
                  busy={busyIds.has(user.id)}
                  onRoleChange={(role) => handleRoleChange(user, role)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {/* Mounted only while open, so the form starts empty each time */}
      {createOpen ? (
        <CreateUserDialog onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
      ) : null}

      <TempPasswordDialog
        credentials={tempPassword}
        onClose={() => setTempPassword(null)}
        onCopied={() => toast.success('Password copied')}
      />
    </Stack>
  )
}

function UserRow({ user, isSelf, busy, onRoleChange }) {
  return (
    <TableRow>
      <TableCell>{user.full_name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {/* You can't change your own role, so the last admin can't lock everyone out. Your row
            shows the role as plain text instead of a dropdown. */}
        {isSelf ? (
          <Chip size="small" label={`${userRoleLabels[user.role] ?? user.role} (you)`} />
        ) : (
          <TextField
            select
            size="small"
            value={user.role ?? ''}
            onChange={(event) => onRoleChange(event.target.value)}
            disabled={busy}
            slotProps={{ htmlInput: { 'aria-label': `Role for ${user.full_name}` } }}
            // The same width for every role, wide enough for the longest ("Conservation officer")
            // so no label is cut off and the column doesn't shift with the label
            sx={{ width: (theme) => theme.spacing(28) }}
          >
            {userRoles.map((role) => (
              <MenuItem key={role} value={role}>
                {userRoleLabels[role]}
              </MenuItem>
            ))}
          </TextField>
        )}
      </TableCell>
      <TableCell>{formatDate(user.created_at)}</TableCell>
    </TableRow>
  )
}

// Stays open if the request fails, so what was typed isn't lost
function CreateUserDialog({ onCreate, onClose }) {
  const [form, setForm] = useState({ fullName: '', email: '', role: 'botanist' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [busy, setBusy] = useState(false)

  const setField = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    const email = form.email.trim()
    const errors = {
      fullName: form.fullName.trim() ? null : 'Enter the full name.',
      email: EMAIL_PATTERN.test(email) ? null : 'Enter a valid email address.',
    }
    setFieldErrors(errors)
    if (errors.fullName || errors.email) return

    setSubmitError(null)
    setBusy(true)
    const error = await onCreate({
      fullName: form.fullName.trim(),
      email,
      role: form.role,
    })
    setBusy(false)

    if (error) setSubmitError(error)
    else onClose()
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { component: 'form', onSubmit: handleSubmit, noValidate: true } }}
    >
      <DialogTitle>Add user</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Full name"
            value={form.fullName}
            onChange={setField('fullName')}
            error={Boolean(fieldErrors.fullName)}
            helperText={fieldErrors.fullName}
            disabled={busy}
            autoFocus
            fullWidth
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={setField('email')}
            error={Boolean(fieldErrors.email)}
            helperText={fieldErrors.email ?? 'A temporary password is generated for you to pass on.'}
            disabled={busy}
            fullWidth
          />
          <TextField
            select
            label="Role"
            value={form.role}
            onChange={setField('role')}
            disabled={busy}
            fullWidth
          >
            {userRoles.map((role) => (
              <MenuItem key={role} value={role}>
                {userRoleLabels[role]}
              </MenuItem>
            ))}
          </TextField>
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          Create account
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Shown once after an account is created. The password isn't stored anywhere in the page,
// so closing this dialog is the last chance to copy it.
function TempPasswordDialog({ credentials, onClose, onCopied }) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(credentials.password)
      onCopied()
    } catch {
      // Clipboard blocked: the password is still on screen to copy by hand
    }
  }

  return (
    <Dialog open={Boolean(credentials)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Account created</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body1">
            Pass this temporary password to {credentials?.email}. It won't be shown again.
          </Typography>
          <Typography
            variant="body1"
            sx={{ fontFamily: 'monospace', userSelect: 'all', wordBreak: 'break-all' }}
          >
            {credentials?.password}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleCopy}>Copy</Button>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}