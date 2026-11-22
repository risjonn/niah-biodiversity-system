import { Linking, Platform } from 'react-native'

// Opens the phone's own maps app with a pin at the position: Apple Maps on iOS, the geo: handler
// (usually Google Maps) on Android. Falls back to Google Maps in the browser if that can't open.
// `label` names the pin.
export async function openInMaps(latitude, longitude, label) {
  const position = `${latitude},${longitude}`
  const name = encodeURIComponent(label ?? 'Plant')
  const url = Platform.select({
    ios: `maps://?ll=${position}&q=${name}`,
    default: `geo:${position}?q=${position}(${name})`,
  })
  try {
    await Linking.openURL(url)
  } catch {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${position}`).catch(() => {})
  }
}
