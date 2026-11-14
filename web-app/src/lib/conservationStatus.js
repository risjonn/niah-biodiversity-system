// Matches the conservation_status enum in database/schema/001_initial_schema.sql, least to most
// threatened, so it doubles as the order for filter options
export const conservationStatuses = [
  'least_concern',
  'near_threatened',
  'vulnerable',
  'endangered',
  'critically_endangered',
]

export const conservationStatusLabels = {
  least_concern: 'Least concern',
  near_threatened: 'Near threatened',
  vulnerable: 'Vulnerable',
  endangered: 'Endangered',
  critically_endangered: 'Critically endangered',
}

// MUI Chip colours, which come from the theme palette (warning is the alert token, and
// nearThreatened and criticallyEndangered are custom palette colours). They match
// chartTokens.conservationStatus. Statuses not listed use the neutral 'default'.
const chipColors = {
  least_concern: 'success',
  near_threatened: 'nearThreatened',
  vulnerable: 'warning',
  endangered: 'error',
  critically_endangered: 'criticallyEndangered',
}

export function conservationStatusChipColor(status) {
  return chipColors[status] ?? 'default'
}
