import { useCallback } from 'react'
import { supabase } from '../lib/supabase' // ASSUMED path
import { QR_CODE_PATTERN, normaliseQrCode } from '../lib/qrCode'

// Botanist lookup. Runs as the signed-in user, so RLS decides what they can see (approved plants
// plus their own pending ones). Resolves to { plant } or { message }.
export function usePlantLookup() {
  return useCallback(async (rawCode) => {
    const code = normaliseQrCode(rawCode)
    if (!QR_CODE_PATTERN.test(code)) return { message: "This isn't a Niah plant tag." }

    const { data, error } = await supabase
      .from('plants') // ASSUMED table name
      .select('id, qr_code, status')
      .eq('qr_code', code)
      .maybeSingle()

    // Not the same as "Not registered yet": offline must not look like a new tag
    if (error) return { message: "Couldn't check this tag. Connect to the internet and try again." }
    if (!data) return { message: 'Not registered yet.' }
    return { plant: data }
  }, [])
}