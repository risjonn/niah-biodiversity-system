// review_status values (database/schema/001_initial_schema.sql), in the order the filters list them
export const reviewStatuses = ['approved', 'pending_review', 'rejected']

export const reviewStatusLabels = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

// MUI chip colours, the same as the review status charts (see "Status colours" in
// docs/design-system.md)
export const reviewStatusChipColors = {
  pending_review: 'warning',
  approved: 'success',
  rejected: 'error',
}
