// Where each role lands after signing in. Botanists have no entry because they use the mobile app
// only, so any role missing from this map has no access to the web dashboard.
export const homePathByRole = {
  conservation_officer: '/dashboard',
  admin: '/dashboard',
}

export const roleLabels = {
  botanist: 'Botanist',
  conservation_officer: 'Conservation officer',
  admin: 'Admin',
}
