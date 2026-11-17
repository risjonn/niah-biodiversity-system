import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { QR_CODE_PATTERN, normaliseQrCode } from '../lib/qrCode'

// Not the same as "Not registered yet": offline must not look like a new tag
const LOOKUP_FAILED = { message: "Couldn't check this tag. Connect to the internet and try again." }

// Botanist lookup. Botanists can only read their own rows in plants (database/schema/005), so
// approved records from any botanist come from plants_public and the rest from plants.
// Resolves to { plant: { id, qr_code, species_id, review_status } } or { message }.
export function usePlantLookup() {
  return useCallback(async (rawCode) => {
    const code = normaliseQrCode(rawCode)
    if (!QR_CODE_PATTERN.test(code)) return { message: "This isn't a Niah plant tag." }

    try {
      const approved = await supabase
        .from('plants_public')
        .select('id, qr_code, species_id')
        .eq('qr_code', code)
        .maybeSingle()
      if (approved.error) return LOOKUP_FAILED
      if (approved.data) return { plant: { ...approved.data, review_status: 'approved' } }

      const own = await supabase
        .from('plants')
        .select('id, qr_code, species_id, review_status')
        .eq('qr_code', code)
        .maybeSingle()
      if (own.error) return LOOKUP_FAILED
      if (!own.data) return { message: 'Not registered yet.' }
      return { plant: own.data }
    } catch {
      return LOOKUP_FAILED
    }
  }, [])
}
