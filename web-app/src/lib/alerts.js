import DirectionsRunOutlinedIcon from '@mui/icons-material/DirectionsRunOutlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import ThermostatOutlinedIcon from '@mui/icons-material/ThermostatOutlined'
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined'
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined'

// Shared by the sensors page and the dashboard's latest alerts

// Matches the alert_type enum in database/schema/001_initial_schema.sql. Nothing raises
// node_offline yet; offline status is worked out on the sensors page from last_received_at.
export const alertTypeLabels = {
  motion_detected: 'Motion detected',
  temperature_anomaly: 'Temperature out of range',
  humidity_anomaly: 'Humidity out of range',
  node_offline: 'Node offline',
}

// An icon for each alert type. Look one up with a fallback to DefaultAlertIcon, for a type added
// to the enum later: `alertTypeIcons[type] ?? DefaultAlertIcon`.
export const alertTypeIcons = {
  temperature_anomaly: ThermostatOutlinedIcon,
  humidity_anomaly: WaterDropOutlinedIcon,
  motion_detected: DirectionsRunOutlinedIcon,
  node_offline: WifiOffOutlinedIcon,
}
export const DefaultAlertIcon = SensorsOutlinedIcon

// Matches the alert_severity enum. Labels for the severity chips, and the theme palette colour
// for each severity: the chips, the dashboard's icon tiles and the sensors page timeline. MUI's
// warning colour is the alert token, which docs/design-system.md reserves for warnings and sensor
// alerts.
export const severityLabels = { high: 'High', medium: 'Medium', low: 'Low' }
export const severityColors = { high: 'error', medium: 'warning', low: 'primary' }

// The reading that raised an alert, e.g. "31.5 °C", from the reading embedded with the alert
// (alerts.sensor_reading_id, database/schema/009). Null when there is none (node_offline) or
// the value is missing.
export function alertReadingText(alert) {
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
