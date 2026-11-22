import { distanceFromInstalled, formatDistance, formatPosition } from './geo'

// Labels and icons for sensor alerts, ported from web-app/src/lib/alerts.js. Icons are Ionicons
// names (the web uses MUI icons). Each device code's severity and one-line meaning come from
// device_alert_codes (database/schema/018), embedded with each alert, so they are not repeated
// here.

// Matches the alert_type enum (001), plus device_alert from 018
export const alertTypeLabels = {
  motion_detected: 'Motion detected',
  temperature_anomaly: 'Temperature out of range',
  humidity_anomaly: 'Humidity out of range',
  node_offline: 'Node offline',
  device_alert: 'Device alert',
}

const alertTypeIcons = {
  temperature_anomaly: 'thermometer-outline',
  humidity_anomaly: 'water-outline',
  motion_detected: 'walk-outline',
  node_offline: 'cloud-offline-outline',
  device_alert: 'warning-outline',
}
// For a type added to the enum later
const DEFAULT_ALERT_ICON = 'radio-outline'

// The 16 Forest Node codes in device_alert_codes (018). A code added to the table later shows as
// its code with the device alert icon.
export const deviceAlertCodes = {
  NORMAL: { label: 'Normal', icon: 'checkmark-circle-outline' },
  MOTION_ONLY: { label: 'Motion only', icon: 'paw-outline' },
  TILT_ONLY: { label: 'Tilt only', icon: 'sync-outline' },
  WEATHER_STORM: { label: 'Weather storm', icon: 'thunderstorm-outline' },
  MAINTENANCE_MODE: { label: 'Maintenance mode', icon: 'construct-outline' },
  POACHING_RISK: { label: 'Poaching risk', icon: 'person-outline' },
  IMPACT_DETECTED: { label: 'Impact detected', icon: 'pulse-outline' },
  LOITERING: { label: 'Loitering', icon: 'hourglass-outline' },
  REPEATED_DISTURBANCE: { label: 'Repeated disturbance', icon: 'repeat-outline' },
  NIGHT_POACHING_RISK: { label: 'Night poaching risk', icon: 'moon-outline' },
  CRITICAL_FALL: { label: 'Critical fall', icon: 'arrow-down-circle-outline' },
  PLANT_STOLEN_MOVING: { label: 'Plant stolen or moving', icon: 'navigate-outline' },
  GPS_SHIELDED_OR_JAMMED: { label: 'GPS shielded or jammed', icon: 'eye-off-outline' },
  FIRE_OR_CANOPY_BREACH: { label: 'Fire or canopy breach', icon: 'flame-outline' },
  TAMPER_LID_OPENED: { label: 'Lid opened', icon: 'lock-open-outline' },
  POWER_LOSS: { label: 'Power loss', icon: 'battery-dead-outline' },
}

export function isDeviceAlert(alert) {
  return alert.alert_type === 'device_alert'
}

// What an alert is called on screen: the code's label for a device alert ("Critical fall"),
// otherwise its type's label ("Temperature out of range")
export function alertLabel(alert) {
  if (isDeviceAlert(alert) && alert.alert_code) {
    return deviceAlertCodes[alert.alert_code]?.label ?? alert.alert_code
  }
  return alertTypeLabels[alert.alert_type] ?? alert.alert_type
}

// The Ionicons name for the alert: the code's icon for a device alert, otherwise its type's
export function alertIconName(alert) {
  if (isDeviceAlert(alert)) return deviceAlertCodes[alert.alert_code]?.icon ?? alertTypeIcons.device_alert
  return alertTypeIcons[alert.alert_type] ?? DEFAULT_ALERT_ICON
}

// One line saying what the alert means: for a device alert the code's meaning from
// device_alert_codes (embedded as `device_alert_code`, see hooks/useAlerts.js), otherwise, and if
// that couldn't be read, the alert's own message
export function alertMeaning(alert) {
  if (isDeviceAlert(alert) && alert.device_alert_code?.description) {
    return alert.device_alert_code.description
  }
  return alert.message ?? null
}

// Matches the alert_severity enum (001)
export const severityLabels = { high: 'High', medium: 'Medium', low: 'Low' }

// Device codes whose alerts show where the box was: the reading's GPS position and its distance
// from the node's installed position
const POSITION_CODES = new Set(['PLANT_STOLEN_MOVING', 'GPS_SHIELDED_OR_JAMMED'])

// For an alert with one of POSITION_CODES: { latitude, longitude, distance } from the reading that
// raised it, with distance in metres from the node's installed position (null if that's
// unknown). latitude and longitude are null when the reading had no GPS fix, which is likely for
// GPS_SHIELDED_OR_JAMMED. Null for every other alert.
export function alertPosition(alert) {
  if (!isDeviceAlert(alert) || !POSITION_CODES.has(alert.alert_code)) return null
  const latitude = alert.reading?.latitude ?? null
  const longitude = alert.reading?.longitude ?? null
  if (latitude == null || longitude == null) return { latitude: null, longitude: null, distance: null }
  return { latitude, longitude, distance: distanceFromInstalled(alert.sensor_nodes, latitude, longitude) }
}

// The reading that raised the alert, e.g. "31.5 °C", from the reading embedded with it. For the
// POSITION_CODES, where the box was and how far from its installed position. Null when there is
// no reading (node_offline) or the value is missing.
export function alertReadingText(alert) {
  const position = alertPosition(alert)
  if (position) {
    if (position.latitude == null) return 'No GPS position on this reading'
    return [
      `At ${formatPosition(position.latitude, position.longitude)}`,
      position.distance != null ? `${formatDistance(position.distance)} from installed position` : null,
    ]
      .filter(Boolean)
      .join(', ')
  }

  const reading = alert.reading
  if (!reading) return null
  const number = (value) => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 1 })
  if (alert.alert_type === 'temperature_anomaly' && reading.temperature != null) {
    return `${number(reading.temperature)} °C`
  }
  if (alert.alert_type === 'humidity_anomaly' && reading.humidity != null) {
    return `${number(reading.humidity)} %`
  }
  if (alert.alert_type === 'motion_detected' && reading.motion_duration_seconds != null) {
    return `Motion for ${number(reading.motion_duration_seconds)} s`
  }
  return null
}
