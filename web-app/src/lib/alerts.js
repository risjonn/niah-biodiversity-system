import { createElement } from 'react'
import BatteryAlertOutlinedIcon from '@mui/icons-material/BatteryAlertOutlined'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import DirectionsRunOutlinedIcon from '@mui/icons-material/DirectionsRunOutlined'
import EngineeringOutlinedIcon from '@mui/icons-material/EngineeringOutlined'
import GpsOffOutlinedIcon from '@mui/icons-material/GpsOffOutlined'
import HourglassBottomOutlinedIcon from '@mui/icons-material/HourglassBottomOutlined'
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import NightlightOutlinedIcon from '@mui/icons-material/NightlightOutlined'
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined'
import PetsOutlinedIcon from '@mui/icons-material/PetsOutlined'
import RepeatOutlinedIcon from '@mui/icons-material/RepeatOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import Rotate90DegreesCwOutlinedIcon from '@mui/icons-material/Rotate90DegreesCwOutlined'
import ScreenRotationOutlinedIcon from '@mui/icons-material/ScreenRotationOutlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import ThermostatOutlinedIcon from '@mui/icons-material/ThermostatOutlined'
import ThunderstormOutlinedIcon from '@mui/icons-material/ThunderstormOutlined'
import VibrationOutlinedIcon from '@mui/icons-material/VibrationOutlined'
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined'
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined'
import WrongLocationOutlinedIcon from '@mui/icons-material/WrongLocationOutlined'
import { distanceFromInstalled, formatDistance, formatPosition } from './geo'

// Shared by the sensors page and the dashboard's latest alerts

// Matches the alert_type enum in database/schema/001_initial_schema.sql, plus device_alert from
// 018 (raised by the Forest Node itself; alerts.alert_code says which code). Nothing raises
// node_offline yet; offline status is worked out on the sensors page from last_received_at.
export const alertTypeLabels = {
  motion_detected: 'Motion detected',
  temperature_anomaly: 'Temperature out of range',
  humidity_anomaly: 'Humidity out of range',
  node_offline: 'Node offline',
  device_alert: 'Device alert',
}

// An icon for each alert type. Look one up with a fallback to DefaultAlertIcon, for a type added
// to the enum later: `alertTypeIcons[type] ?? DefaultAlertIcon`.
export const alertTypeIcons = {
  temperature_anomaly: ThermostatOutlinedIcon,
  humidity_anomaly: WaterDropOutlinedIcon,
  motion_detected: DirectionsRunOutlinedIcon,
  node_offline: WifiOffOutlinedIcon,
  device_alert: ReportProblemOutlinedIcon,
}
export const DefaultAlertIcon = SensorsOutlinedIcon

// A readable label and an icon for each of the 16 Forest Node codes in device_alert_codes (018),
// used for device alerts and for a node's latest device state. Only the wording and the icon live
// here: each code's severity and one-line meaning come from device_alert_codes, which the app
// reads (embedded with each alert, and on sensor_node_latest from 020), so they are never repeated
// in the app. A code added to the table later shows as its code with DefaultAlertIcon.
export const deviceAlertCodes = {
  NORMAL: { label: 'Normal', icon: CheckCircleOutlinedIcon },
  MOTION_ONLY: { label: 'Motion only', icon: PetsOutlinedIcon },
  TILT_ONLY: { label: 'Tilt only', icon: ScreenRotationOutlinedIcon },
  WEATHER_STORM: { label: 'Weather storm', icon: ThunderstormOutlinedIcon },
  MAINTENANCE_MODE: { label: 'Maintenance mode', icon: EngineeringOutlinedIcon },
  POACHING_RISK: { label: 'Poaching risk', icon: PersonSearchOutlinedIcon },
  IMPACT_DETECTED: { label: 'Impact detected', icon: VibrationOutlinedIcon },
  LOITERING: { label: 'Loitering', icon: HourglassBottomOutlinedIcon },
  REPEATED_DISTURBANCE: { label: 'Repeated disturbance', icon: RepeatOutlinedIcon },
  NIGHT_POACHING_RISK: { label: 'Night poaching risk', icon: NightlightOutlinedIcon },
  CRITICAL_FALL: { label: 'Critical fall', icon: Rotate90DegreesCwOutlinedIcon },
  PLANT_STOLEN_MOVING: { label: 'Plant stolen or moving', icon: WrongLocationOutlinedIcon },
  GPS_SHIELDED_OR_JAMMED: { label: 'GPS shielded or jammed', icon: GpsOffOutlinedIcon },
  FIRE_OR_CANOPY_BREACH: { label: 'Fire or canopy breach', icon: LocalFireDepartmentOutlinedIcon },
  TAMPER_LID_OPENED: { label: 'Lid opened', icon: LockOpenOutlinedIcon },
  POWER_LOSS: { label: 'Power loss', icon: BatteryAlertOutlinedIcon },
}

// The label for a Forest Node code, e.g. "Critical fall"
export function deviceCodeLabel(code) {
  return deviceAlertCodes[code]?.label ?? code
}

export function isDeviceAlert(alert) {
  return alert.alert_type === 'device_alert'
}

// The alert filter on the sensors page. Device alerts are the Forest Node's own codes;
// environment alerts are everything the database raises from the readings (temperature,
// humidity and motion limits, 009).
export const alertSources = {
  all: { label: 'All', matches: () => true },
  device: { label: 'Device', matches: isDeviceAlert },
  environment: { label: 'Environment', matches: (alert) => !isDeviceAlert(alert) },
}

// What an alert is called on screen: the code's label for a device alert ("Critical fall"),
// otherwise its type's label ("Temperature out of range")
export function alertLabel(alert) {
  if (isDeviceAlert(alert) && alert.alert_code) return deviceCodeLabel(alert.alert_code)
  return alertTypeLabels[alert.alert_type] ?? alert.alert_type
}

// The alert's icon as an element, with `props` passed to it: the code's icon for a device alert,
// otherwise its type's. An element rather than the component, so the caller doesn't pick a
// component during render (react-hooks/static-components).
export function alertIcon(alert, props) {
  const Icon = isDeviceAlert(alert)
    ? (deviceAlertCodes[alert.alert_code]?.icon ?? alertTypeIcons.device_alert)
    : (alertTypeIcons[alert.alert_type] ?? DefaultAlertIcon)
  return createElement(Icon, props)
}

// One line saying what the alert means. For a device alert, the code's meaning from
// device_alert_codes (embedded as `device_alert_code`, see hooks/useSensors.js). Otherwise, and if
// the meaning couldn't be read, the alert's own message.
export function alertMeaning(alert) {
  if (isDeviceAlert(alert) && alert.device_alert_code?.description) {
    return alert.device_alert_code.description
  }
  return alert.message ?? null
}

// Matches the alert_severity enum. Labels for the severity chips, and the theme palette colour
// for each severity: the chips, the dashboard's icon tiles and the sensors page timeline. MUI's
// warning colour is the alert token, which docs/design-system.md reserves for warnings and sensor
// alerts.
export const severityLabels = { high: 'High', medium: 'Medium', low: 'Low' }
export const severityColors = { high: 'error', medium: 'warning', low: 'primary' }

// Chip colours for a node's latest device state, by the code's severity in device_alert_codes
// (INFO, WARNING or CRITICAL). The label is always written on the chip, so it never relies on
// colour alone.
export const deviceStateColors = { INFO: 'default', WARNING: 'warning', CRITICAL: 'error' }

// Device codes whose alerts show where the box was: the reading's GPS position and its distance
// from the node's installed position
const POSITION_CODES = new Set(['PLANT_STOLEN_MOVING', 'GPS_SHIELDED_OR_JAMMED'])

// For an alert with one of POSITION_CODES: { latitude, longitude, distance } from the reading that
// raised it, with distance in metres from the node's installed position (null if that's
// unknown). { latitude: null } when the reading had no GPS fix, which is likely for
// GPS_SHIELDED_OR_JAMMED. Null for every other alert.
export function alertPosition(alert) {
  if (!isDeviceAlert(alert) || !POSITION_CODES.has(alert.alert_code)) return null
  const latitude = alert.reading?.latitude ?? null
  const longitude = alert.reading?.longitude ?? null
  if (latitude == null || longitude == null) return { latitude: null, longitude: null, distance: null }
  return { latitude, longitude, distance: distanceFromInstalled(alert.sensor_nodes, latitude, longitude) }
}

// The reading that raised an alert, e.g. "31.5 °C", from the reading embedded with the alert
// (alerts.sensor_reading_id, database/schema/009). For PLANT_STOLEN_MOVING and
// GPS_SHIELDED_OR_JAMMED, where the box was and how far from its installed position. Null when
// there is no reading (node_offline) or the value is missing.
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
