import AsyncStorage from '@react-native-async-storage/async-storage'

// The signed-in user's own records from their last successful load, so Home and Records still
// show them offline. One account at a time (a new user's load replaces it), and removed on
// sign-out (AuthContext).
const CACHE_KEY = 'niah-my-plants-cache'

export async function savePlants(userId, plants, savedAt) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ userId, savedAt, plants }))
  } catch {
    // The fresh list is still shown; the older copy stays as the fallback
  }
}

// { plants, savedAt } for this user, or null if nothing is saved for them
export async function readSavedPlants(userId) {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(CACHE_KEY))
    return saved?.userId === userId && Array.isArray(saved.plants) && saved.savedAt ? saved : null
  } catch {
    return null
  }
}

export function forgetSavedPlants() {
  return AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
}
