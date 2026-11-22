// Distances between GPS positions, for telling how far a sensor box is from where it was
// installed. The same as web-app/src/lib/geo.js. Plain functions with no React or theme imports.

// Mean radius of the Earth, in metres
const EARTH_RADIUS_M = 6371000

// The great-circle (haversine) distance in metres between two positions in decimal degrees
export function distanceMetres(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const radians = (degrees) => (Number(degrees) * Math.PI) / 180
  const dLatitude = radians(toLatitude) - radians(fromLatitude)
  const dLongitude = radians(toLongitude) - radians(fromLongitude)
  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(dLongitude / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

// How far a GPS fix is from a node's installed position, in metres, or null when either position
// is missing. `node` has the installed latitude and longitude (sensor_nodes).
export function distanceFromInstalled(node, latitude, longitude) {
  if (latitude == null || longitude == null || node?.latitude == null || node?.longitude == null) {
    return null
  }
  return distanceMetres(node.latitude, node.longitude, latitude, longitude)
}

// e.g. "42 m" or "1.3 km"
export function formatDistance(metres) {
  if (metres >= 1000) {
    return `${(metres / 1000).toLocaleString('en-MY', { maximumFractionDigits: 1 })} km`
  }
  return `${Math.round(metres).toLocaleString('en-MY')} m`
}

// e.g. "3.81235, 113.77654"
export function formatPosition(latitude, longitude) {
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
}
