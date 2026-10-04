import { useCallback, useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

// The device's current GPS position. Asks for foreground location permission and takes a reading
// as soon as the calling screen opens; `refresh` asks and reads again.
//   status: 'locating' | 'ready' | 'denied' | 'error'
//   coords: { latitude, longitude, accuracy } once status is 'ready', otherwise null
//   message: why there is no position, ready to show on screen, when status is 'denied' or 'error'
export function useCurrentLocation() {
  const [location, setLocation] = useState({ status: 'locating', coords: null, message: null })
  // Bumped on every reading and on unmount, so a slow earlier reading never overwrites a newer one
  const latestRequest = useRef(0)

  const read = useCallback(async () => {
    const request = ++latestRequest.current
    const next = await readLocation()
    if (request === latestRequest.current) setLocation(next)
  }, [])

  useEffect(() => {
    const requests = latestRequest
    read()
    // Any reading still running when the screen closes is ignored
    return () => {
      requests.current++
    }
  }, [read])

  const refresh = useCallback(() => {
    setLocation({ status: 'locating', coords: null, message: null })
    read()
  }, [read])

  return { ...location, refresh }
}

async function readLocation() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync()
    if (!permission.granted) {
      return {
        status: 'denied',
        coords: null,
        message: permission.canAskAgain
          ? 'Location permission is needed to record where this plant is. Tap "Refresh location" to allow it.'
          : 'Location access is turned off for this app. Turn it on in your phone settings, then tap "Refresh location".',
      }
    }

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    const { latitude, longitude, accuracy } = position.coords
    return { status: 'ready', coords: { latitude, longitude, accuracy }, message: null }
  } catch {
    // Thrown when location services are off or no position could be found
    return {
      status: 'error',
      coords: null,
      message:
        'Your location could not be read. Check that location services are turned on, then tap "Refresh location".',
    }
  }
}
