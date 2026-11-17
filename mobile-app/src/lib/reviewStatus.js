// review_status values (database/schema/001_initial_schema.sql), in the order Home lists them
export const reviewStatuses = ['pending_review', 'approved', 'rejected']

export const reviewStatusLabels = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

// The short names on Home's summary chips
export const reviewStatusShortLabels = {
  pending_review: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}
