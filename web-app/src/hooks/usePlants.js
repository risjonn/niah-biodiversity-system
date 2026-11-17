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
      // A rejection needs a reason: the botanist sees it in My Records (rejection_reason, 001)
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

  // The signed-in user's review queue, oldest first. Row-level security returns every pending
  // record to conservation officers and admins, but their own are left out: nobody can review a
  // record they recorded (database/schema/004 and 015). Same filter as countPendingReviews, so
  // the dashboard total matches this list.
  const fetchPendingPlants = useCallback(async () => {
    if (!userId) {
      return { data: [], error: 'You need to be signed in to review plant records.' }
    }
    const { data, error } = await supabase
      .from('plants')
      .select(PLANT_WITH_SPECIES)
      .eq('review_status', 'pending_review')
      .neq('recorded_by', userId)
      .order('recorded_at', { ascending: true })

    if (error) return { data: [], error: plantErrorMessage(error) }
    return { data, error: null }
  }, [userId])

  // How many pending records the signed-in user can review. Their own records are left out,
  // because nobody can review a record they recorded (database/schema/004 and 015).
  const countPendingReviews = useCallback(() => {
    if (!userId) {
      return Promise.resolve({ data: null, error: 'You need to be signed in to see this total.' })
    }
    return countResult(
      supabase
        .from('plants')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending_review')
        .neq('recorded_by', userId),
    )
  }, [userId])

  return {
    fetchPendingPlants,
    fetchApprovedPlants,
    fetchPlantRecords,
    countPendingReviews,
    countApprovedPlants,
    getPlantById,
    getPlantsBySpecies,
    getPlantPhotoUrl,
    getPlantPhotoUrls,
    reviewPlant,
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// One page of every plant record (all statuses), newest first, for the plant records page.
// Row-level security returns them all to conservation officers and admins. Filters:
// - status: a review_status, or null for all
// - speciesId: a species id, or null for all
// - search: part of a QR code, any case
// Resolves to { data: { rows, total }, error }, total being every match, not just this page.
async function fetchPlantRecords({ status, speciesId, search, page = 0, pageSize = 25 } = {}) {
  const from = page * pageSize
  let query = supabase
    .from('plants')
    .select(PLANT_WITH_SPECIES, { count: 'exact' })
    .order('recorded_at', { ascending: false })
    // A tie-breaker, so records recorded at the same moment keep their place between pages
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1)

  if (status) query = query.eq('review_status', status)
  if (speciesId) query = query.eq('species_id', speciesId)
  const term = search?.trim()
  // % and _ are LIKE wildcards, so they are escaped to match literally
  if (term) query = query.ilike('qr_code', `%${term.replace(/[\\%_]/g, '\\$&')}%`)

  const { data, error, count } = await query
  if (error) return { data: { rows: [], total: 0 }, error: plantErrorMessage(error) }
  return { data: { rows: data, total: count ?? data.length }, error: null }
}

// One record with its species, or data: null with no error when there is none with that id
async function getPlantById(id) {
  if (!UUID_PATTERN.test(id ?? '')) return { data: null, error: null }
  const { data, error } = await supabase
    .from('plants')
    .select(PLANT_WITH_SPECIES)
    .eq('id', id)
    .maybeSingle()
  if (error) return { data: null, error: plantErrorMessage(error) }
  return { data, error: null }
}

// Signed URLs for several photos in one request, for a page of thumbnails. Resolves to
// { data: { [path]: signedUrl }, error }; a path storage couldn't sign is left out.
async function getPlantPhotoUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return { data: {}, error: null }

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(unique, PHOTO_URL_LIFETIME_SECONDS)

  if (error) return { data: {}, error: photoErrorMessage(error) }
  const urls = {}
  for (const item of data ?? []) {
    if (item.signedUrl && !item.error) urls[item.path] = item.signedUrl
  }
  return { data: urls, error: null }
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

function countApprovedPlants() {
  return countResult(
    supabase
      .from('plants')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', 'approved'),
  )
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

// Every record of one species, newest first, with only the columns a species page lists. Row-level
// security returns all of them to conservation officers and admins. Who recorded each one is left
// out: profiles are only readable by their owner, so officers can't see other people's names.
async function getPlantsBySpecies(speciesId) {
  const { data, error } = await supabase
    .from('plants')
    .select('id, qr_code, review_status, recorded_at, location_description')
    .eq('species_id', speciesId)
    .order('recorded_at', { ascending: false })

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
