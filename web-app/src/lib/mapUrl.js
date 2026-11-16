// A Google Maps link to a point, for the "Open in map" links on the sensor and plant review pages.
// Opened in a new tab, so nothing is loaded into this app (CSP).
export function mapUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}
