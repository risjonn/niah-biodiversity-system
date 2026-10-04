import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { containsAnyFilter, countResult, queryErrorMessage } from '../lib/queryHelpers'

// Each plant comes back with the basics of its species, for showing names without a second query
const PLANT_WITH_SPECIES = '*, species(id, scientific_name, common_name, conservation_status)'

const SEARCH_COLUMNS = ['qr_code', 'location_description', 'morphological_notes']

const REVIEW_STATUSES = ['approved', 'rejected']

const PHOTO_BUCKET = 'plant-photos'
// Long enough to cover a review session, short enough that a copied link soon stops working
const PHOTO_URL_LIFETIME_SECONDS = 3600

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

  return {
    fetchPendingPlants,
    fetchApprovedPlants,
    countPendingPlants,
    countApprovedPlants,
    getPlantPhotoUrl,
    reviewPlant,
  }
}

// Plant photos are in a private bucket (database/schema/006_plant_photos_storage.sql) and
// photo_url holds the file's storage path, so showing one needs a short-lived signed URL.
// Resolves to { data: signedUrl, error }; storage only signs it for the photo's owner and for
// conservation officers and admins.
async function getPlantPhotoUrl(path) {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, PHOTO_URL_LIFETIME_SECONDS)

  if (error) return { data: null, error: photoErrorMessage(error) }
  return { data: data.signedUrl, error: null }
}

// How many records are waiting for review. Row-level security only counts pending records for
// conservation officers and admins.
function countPendingPlants() {
  return countPlantsWithStatus('pending_review')
}

function countApprovedPlants() {
  return countPlantsWithStatus('approved')
}

function countPlantsWithStatus(reviewStatus) {
  return countResult(
    supabase
      .from('plants')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', reviewStatus),
  )
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

function photoErrorMessage(error) {
  // Request never reached the server (offline, server unreachable)
  if (error.name === 'StorageUnknownError') {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  // Storage answers "not found" both for a missing file and for one the user may not read
  if (Number(error.statusCode ?? error.status) === 404 || /not found/i.test(error.message)) {
    return 'This photo could not be found. It may not have finished uploading.'
  }
  return 'This photo could not be loaded. Try again later.'
}

function plantErrorMessage(error) {
  if (error.code === '42501') return 'Your account is not allowed to review plant records.'
  return queryErrorMessage(error)
}
