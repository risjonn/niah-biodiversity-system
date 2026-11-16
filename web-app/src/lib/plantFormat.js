// Shown the same way on the review dialog, the plant records page and the record panel

// Five decimal places is about a metre, as precise as a phone GPS fix
export function formatCoordinates(plant) {
  return `${plant.latitude.toFixed(5)}, ${plant.longitude.toFixed(5)}`
}

export function formatHeight(heightCm) {
  return heightCm == null ? '—' : `${heightCm} cm`
}
