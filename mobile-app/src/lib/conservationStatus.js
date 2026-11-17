// Matches the conservation_status enum in database/schema/001_initial_schema.sql, least to most
// threatened, which is also the order of the Species filter chips
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
