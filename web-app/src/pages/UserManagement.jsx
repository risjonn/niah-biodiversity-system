import { useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  ListItemIcon,
  ListItemText,
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
import { alpha } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import TableSkeleton from '../components/TableSkeleton'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useUsers, userRoleLabels, userRoles } from '../hooks/useUsers'
import { formatDate } from '../lib/formatDateTime'
import { roleIcons } from '../lib/roles'
import { avatarColorOf, initialsOf } from '../lib/userDisplay'

// The table's headings, shared with its loading skeleton
const COLUMNS = ['Name', 'Email', 'Role', 'Created']

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Initials avatar size in the table, in px
const AVATAR_SIZE = 36

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const { fetchUsers, createUser, updateUserRole } = useUsers()
  const [result, setResult] = useState(null)
  // Ids of users with a role change running, so their role box can't be changed twice
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  // { email, password } of the account just created, shown once for the admin to pass on
  const [tempPassword, setTempPassword] = useState(null)
  // Filters the loaded users by name or email, in the browser
  const [search, setSearch] = useState('')
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
  const query = search.trim().toLowerCase()
  const shownUsers = query
    ? users.filter((user) =>
        [user.full_name, user.email].some((value) => value?.toLowerCase().includes(query)),
      )
    : users

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
        subtitle={result && !result.error ? accountCount(shownUsers.length, users.length, query) : null}
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
        <TextField
          type="search"
          size="small"
          label="Search users"
          placeholder="Name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: (theme) => theme.spacing(45) } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" aria-hidden="true" />
                </InputAdornment>
              ),
            },
          }}
        />
      ) : null}

      {users.length > 0 && shownUsers.length === 0 ? (
        <EmptyState
          message={`No users match "${search.trim()}"`}
          action={<Button onClick={() => setSearch('')}>Clear search</Button>}
        />
      ) : null}

      {shownUsers.length > 0 ? (
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
              {shownUsers.map((user) => (
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

// "12 accounts", or "3 of 12 accounts" while a search is filtering them
function accountCount(shown, total, query) {
  const accounts = total === 1 ? '1 account' : `${total.toLocaleString()} accounts`
  return query ? `${shown.toLocaleString()} of ${accounts}` : accounts
}

function UserRow({ user, isSelf, busy, onRoleChange }) {
  const avatarColor = avatarColorOf(user.full_name)

  return (
    <TableRow>
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Avatar
            aria-hidden="true"
            sx={(theme) => ({
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              typography: 'body2',
              fontWeight: 600,
              bgcolor: alpha(theme.palette[avatarColor].main, 0.16),
              // The dark shade keeps the letters clear on the pale tile
              color: theme.palette[avatarColor].dark,
            })}
          >
            {initialsOf(user.full_name, user.role)}
          </Avatar>
          <span>{user.full_name}</span>
        </Stack>
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {/* You can't change your own role, so the last admin can't lock everyone out. Your row
            shows the role as a chip instead of a dropdown. */}
        {isSelf ? (
          <RoleChip role={user.role} suffix=" (you)" />
        ) : (
          <TextField
            select
            size="small"
            value={user.role ?? ''}
            onChange={(event) => onRoleChange(event.target.value)}
            disabled={busy}
            slotProps={{
              htmlInput: { 'aria-label': `Role for ${user.full_name}` },
              select: { renderValue: (role) => <RoleChip role={role} /> },
            }}
            // The same width for every role, wide enough for the longest ("Conservation officer")
            // so no label is cut off and the column doesn't shift with the label
            sx={{ width: (theme) => theme.spacing(32) }}
          >
            {userRoles.map((role) => {
              const Icon = roleIcons[role]
              return (
                <MenuItem key={role} value={role}>
                  <ListItemIcon>
                    <Icon fontSize="small" aria-hidden="true" />
                  </ListItemIcon>
                  <ListItemText>{userRoleLabels[role]}</ListItemText>
                </MenuItem>
              )
            })}
          </TextField>
        )}
      </TableCell>
      <TableCell>{formatDate(user.created_at)}</TableCell>
    </TableRow>
  )
}

// The role's label with its icon (botanist, officer, admin), and an optional suffix like " (you)"
function RoleChip({ role, suffix = '' }) {
  const Icon = roleIcons[role]

  return (
    <Chip
      size="small"
      variant="outlined"
      icon={Icon ? <Icon aria-hidden="true" /> : undefined}
      label={`${userRoleLabels[role] ?? role}${suffix}`}
      // Inside the role dropdown, keep the dropdown's pointer rather than the chip's text cursor
      sx={{ cursor: 'inherit' }}
    />
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