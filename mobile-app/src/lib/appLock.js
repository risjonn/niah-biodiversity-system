import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

// The wording of the offer after sign-in, also used for the Settings switch
export const UNLOCK_METHOD_NAME = 'Face ID / fingerprint'

// What this phone can unlock the app with: null when it has neither biometrics nor a passcode set
// up (or can't say), otherwise { biometric }, true when Face ID or a fingerprint is enrolled and
// false when there is only a passcode
export async function getDeviceSecurity() {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    if (level === LocalAuthentication.SecurityLevel.NONE) return null
    return { biometric: level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK }
  } catch {
    return null
  }
}

// Asks for Face ID, a fingerprint or the device passcode. Resolves to the library's
// { success, error } and never throws.
export async function confirmDeviceOwner(promptMessage) {
  try {
    return await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      // The passcode is offered when biometrics fail or aren't set up
      disableDeviceFallback: false,
    })
  } catch (error) {
    console.error('Could not ask for biometric unlock:', error)
    return { success: false, error: 'unknown' }
  }
}

// Closes a prompt that is still up. Android only; elsewhere the library throws, which is ignored.
export function cancelDeviceOwnerPrompt() {
  LocalAuthentication.cancelAuthenticate().catch(() => {})
}

// Each account's choice, kept on this phone across sign-outs. SecureStore keys may only hold
// letters, digits, '.', '-' and '_', which a user id (a UUID) satisfies.
function choiceKey(userId) {
  return `niah-biometric-unlock_${userId}`
}

// true or false once the user has chosen, null if they haven't (or it can't be read)
export async function readUnlockChoice(userId) {
  try {
    const value = await SecureStore.getItemAsync(choiceKey(userId))
    return value === 'on' ? true : value === 'off' ? false : null
  } catch {
    return null
  }
}

// Throws if the choice couldn't be saved
export function saveUnlockChoice(userId, enabled) {
  return SecureStore.setItemAsync(choiceKey(userId), enabled ? 'on' : 'off')
}
