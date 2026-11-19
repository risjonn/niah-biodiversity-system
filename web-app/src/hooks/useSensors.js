import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { countResult, queryErrorMessage } from '../lib/queryHelpers'

// Each alert comes with its node's identifier, and the name of whoever acknowledged it. Profiles
// are only readable by their owner and by admins, so for a conservation officer the name is null
// unless they acknowledged it themselves.
const ALERT_WITH_NODE =
  '*, sensor_nodes(node_identifier), acknowledged_by_profile:profiles(full_name)'

// The same, plus the reading that raised the alert (alerts.sensor_reading_id, 009) as `reading`,
// null for alerts without one. Read by alertReadingText in lib/alerts.js.
const ALERT_WITH_READING = `${ALERT_WITH_NODE}, reading:sensor_readings(temperature, humidity, motion_duration_seconds)`

// The acknowledged list is history, so only the most recent ones are loaded
const ACKNOWLEDGED_ALERTS_LIMIT = 50

const RECENT_READINGS_LIMIT = 20


// Sensor nodes, their readings, alerts and alert limits for the sensor dashboard. Every function
// resolves to { data, error } and never throws: `error` is a message ready to show on screen (the
// same pattern as usePlants and useSpecies). All of these tables are readable only by conservation
// officers and admins (database/schema/001_initial_schema.sql, 009 and 010).
export function useSensors() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Marks an open alert as acknowledged by the signed-in user. Resolves to the updated alert.
  const acknowledgeAlert = useCallback(
    async (id) => {
      if (!userId) {
        return { data: null, error: 'You need to be signed in to acknowledge alerts.' }
      }

      const { data, error } = await supabase
        .from('alerts')
        .update({
          is_acknowledged: true,
          acknowledged_by: userId,
          acknowledged_at: new Date().toISOString(),
        })
        .eq('id', id)
        // Only open alerts, so two officers can't both acknowledge the same one. The update
        // policy in 010_sensor_node_latest_view.sql enforces the same rule.
        .eq('is_acknowledged', false)
        .select(ALERT_WITH_NODE)
        .maybeSingle()

      if (error) return { data: null, error: sensorErrorMessage(error) }
      // Row-level security hides rows the user can't change instead of raising an error, and the
      // page is only open to staff, so an empty result means someone got there first
      if (!data) {
        return { data: null, error: 'This alert has already been acknowledged.' }
      }
      return { data, error: null }
    },
    [userId],
  )

  return {
    getNodeStatus,
    getAlerts,
    getRecentAlerts,
    countOpenAlerts,
    acknowledgeAlert,
    getRecentReadings,
    getChartReadings,
    getGlobalThresholds,
    getAlertThresholds,
  }
}

// Every sensor node with its plant and latest reading, from the sensor_node_latest view (010).
// Nodes without readings are included with the reading columns null.
async function getNodeStatus() {
  const { data, error } = await supabase
    .from('sensor_node_latest')
    .select('*')
    .order('node_identifier')

  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
}

// The newest alerts, open or acknowledged, for the dashboard. Each comes with its node, and the
// reading that raised it (alerts.sensor_reading_id, 009) as `reading`; null for alerts without
// one. Read-only; row-level security limits alerts and readings to staff.
async function getRecentAlerts(limit = 6) {
  const { data, error } = await supabase
    .from('alerts')
    .select(ALERT_WITH_READING)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
}

// Open alerts newest first, or with `acknowledged: true` the most recently acknowledged ones.
// Each comes with its node and the reading that raised it, as in getRecentAlerts.
async function getAlerts({ acknowledged = false } = {}) {
  let query = supabase.from('alerts').select(ALERT_WITH_READING).eq('is_acknowledged', acknowledged)

  query = acknowledged
    ? query.order('acknowledged_at', { ascending: false }).limit(ACKNOWLEDGED_ALERTS_LIMIT)
    : query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
}

// How many alerts nobody has acknowledged yet, without loading them
function countOpenAlerts() {
  return countResult(
    supabase
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .eq('is_acknowledged', false),
  )
}

// The node's latest readings, newest first by the device's own time
async function getRecentReadings(nodeId) {
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at')
    .eq('sensor_node_id', nodeId)
    .order('recorded_at', { ascending: false })
    .limit(RECENT_READINGS_LIMIT)

  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
}

// Readings grouped per node per hour or day (Sarawak time), from report_sensor_chart in
// database/schema/016_sensor_chart_report.sql. `from` and `to` are ISO date-time strings, `from`
// inclusive and `to` exclusive, at most 31 days apart; `bucket` is 'hour' or 'day'. Each row is
// { sensor_node_id, bucket_start, avg_temperature, avg_humidity, motion_events, readings }, oldest
// bucket first. Only buckets with readings are returned.
async function getChartReadings({ from, to, bucket }) {
  const { data, count, error } = await supabase.rpc(
    'report_sensor_chart',
    { p_from: from, p_to: to, p_bucket: bucket },
    // The total, to tell when the API's 1000-row limit has cut the result short
    { count: 'exact' },
  )

  if (error) return { data: [], error: sensorErrorMessage(error) }
  const rows = data ?? []
  // A week of hourly rows is 168 per node, so this happens from about six nodes up. A partial
  // result would leave the newest hours out, so it is an error rather than a gap.
  if (count != null && count > rows.length) {
    return {
      data: [],
      error: 'There are too many nodes to chart hourly for this period. Choose a shorter period.',
    }
  }
  return { data: rows, error: null }
}

// Every alert limit row (009): the global default (sensor_node_id null) and any node's own limits
async function getAlertThresholds() {
  const { data, error } = await supabase
    .from('alert_thresholds')
    .select('sensor_node_id, temperature_min, temperature_max, humidity_min, humidity_max')

  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
}

// The default alert limits used by every node without its own row (009). Resolves to data: null
// with no error if the global row is missing.
async function getGlobalThresholds() {
  const { data, error } = await supabase
    .from('alert_thresholds')
    .select('temperature_min, temperature_max, humidity_min, humidity_max, motion_window_seconds')
    .is('sensor_node_id', null)
    .maybeSingle()

  if (error) return { data: null, error: sensorErrorMessage(error) }
  return { data, error: null }
}

function sensorErrorMessage(error) {
  if (error.code === '42501') return 'Your account is not allowed to view or change sensor data.'
  return queryErrorMessage(error)
}
