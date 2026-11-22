import NetInfo from '@react-native-community/netinfo'

// A load still waiting after this long is treated as offline. Without a limit, a request made in
// flight mode can wait a long time (Supabase first tries to refresh the session's token).
export const LOAD_TIMEOUT_MS = 8000

// The same test SyncContext uses: connected, and not known to be without internet
export function isOnline(state) {
  return state?.isConnected === true && state.isInternetReachable !== false
}

// Runs request() unless the phone reports being offline, and stops waiting after LOAD_TIMEOUT_MS.
// Resolves to what request() resolves to, or null when offline or out of time (the request itself
// carries on and its result is dropped).
export async function requestOnline(request) {
  const state = await NetInfo.fetch().catch(() => null)
  if (state && (state.isConnected === false || state.isInternetReachable === false)) return null

  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request(), timeout])
  } finally {
    clearTimeout(timer)
  }
}
