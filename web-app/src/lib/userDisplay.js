import { roleLabels } from './roles'

// How a person is shown: their initials, and a colour for their initials avatar. Shared by the
// sidebar's user card and the Users page.

// Theme palette colours for initials avatars, drawn as a pale tile of the colour with its dark
// shade for the letters (as StatCard's icon tiles). The alert (warning) and error colours are left
// out so an avatar never reads as a warning.
const AVATAR_COLORS = ['primary', 'secondary', 'success', 'criticallyEndangered']

// "Siti Nurhaliza" -> "SN", "Daniel" -> "D". The role's first letter when there's no name.
export function initialsOf(name, role) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return (roleLabels[role] ?? '?').charAt(0)
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words.at(-1).charAt(0) : ''
  return (first + last).toUpperCase()
}

// The palette colour for a person's avatar, worked out from their name, so the same name always
// gets the same colour
export function avatarColorOf(name) {
  let hash = 0
  for (const char of name ?? '') hash = (hash * 31 + char.codePointAt(0)) % 1000003
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
