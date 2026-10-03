import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { containsAnyFilter, queryErrorMessage } from '../lib/queryHelpers'

// Each plant comes back with the basics of its species, for showing names without a second query
const PLANT_WITH_SPECIES = '*, species(id, scientific_name, common_name, conservation_status)'

const SEARCH_COLUMNS = ['qr_code', 'location_description', 'morphological_notes']

const REVIEW_STATUSES = ['approved', 'rejected']

// Plant records for review and for species pages. Every function resolves to { data, error } and
// never throws: `error` is a message ready to show on screen (the same pattern as
// mobile-app/src/hooks/usePlants.js and signIn in AuthContext).
export function usePlants() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Approves or rejects a pending record as the signed-in user. Resolves to the updated row.
  const reviewPlant = useCallback(
    async (id, { status, rejectionReason } = {}) => {
      if (!userId) {
        return { data: null, error: 'You need to be signed in to review plant records.' }
      }
      if (!REVIEW_STATUSES.includes(status)) {
        return { data: null, error: 'Choose whether to approve or reject this record.' }
      }
      const reason = rejectionReason?.trim()
      if (status === 'rejected' && !reason) {
        return { data: null, error: 'Give a reason for rejecting this record.' }
      }

      const { data, error } = await supabase
        .from('plants')
        .update({
          review_status: status,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          // Cleared on approval so a reason never sits on an approved record
          rejection_reason: status === 'rejected' ? reason : null,
        })
        .eq('id', id)
        // Only pending records, so two reviewers can't overwrite each other's decision
        .eq('review_status', 'pending_review')
        .select(PLANT_WITH_SPECIES)
        .maybeSingle()

      if (error) return { data: null, error: plantErrorMessage(error) }
      // Row-level security hides rows the user can't change instead of raising an error, so an
      // empty result is a missing record, one already reviewed, or a refused write
      if (!data) {
        return {
          data: null,
          error:
            'This record could not be updated. It may already have been reviewed, or your account may not be allowed to review records.',
        }
      }
      return { data, error: null }
    },
    [userId],
  )

  return { fetchPendingPlants, fetchApprovedPlants, reviewPlant }
}

// The review queue, oldest first. Row-level security only returns other people's pending records
// to conservation officers and admins.
async function fetchPendingPlants() {
  const { data, error } = await supabase
    .from('plants')
    .select(PLANT_WITH_SPECIES)
    .eq('review_status', 'pending_review')
    .order('recorded_at', { ascending: true })

  if (error) return { data: [], error: plantErrorMessage(error) }
  return { data, error: null }
}

// Approved records, newest first. These are public. `search` matches the QR code, location
// description or notes; `speciesId` limits the results to one species.
async function fetchApprovedPlants({ search, speciesId } = {}) {
  let query = supabase
    .from('plants')
    .select(PLANT_WITH_SPECIES)
    .eq('review_status', 'approved')
    .order('recorded_at', { ascending: false })

  const searchFilter = containsAnyFilter(SEARCH_COLUMNS, search)
  if (searchFilter) query = query.or(searchFilter)
  if (speciesId) query = query.eq('species_id', speciesId)

  const { data, error } = await query
  if (error) return { data: [], error: plantErrorMessage(error) }
  return { data, error: null }
}

function plantErrorMessage(error) {
  if (error.code === '42501') return 'Your account is not allowed to review plant records.'
  return queryErrorMessage(error)
}
