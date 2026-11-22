// user_role values (database/schema/001_initial_schema.sql) and what the app calls them

// Conservation officers and admins. RLS lets them read every plant record, its photos, the sensor
// nodes, readings and alerts, and acknowledge alerts (001, 006, 010, 017). Botanists only see
// their own records.
const STAFF_ROLES = ['conservation_officer', 'admin']

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role)
}

export const roleLabels = {
  botanist: 'Botanist',
  conservation_officer: 'Conservation officer',
  admin: 'Admin',
}
