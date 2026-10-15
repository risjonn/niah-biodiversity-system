import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { queryErrorMessage } from '../lib/queryHelpers'

// Each alert comes with its node's identifier, and the name of whoever acknowledged it. Profiles
// are only readable by their owner and by admins, so for a conservation officer the name is null
// unless they acknowledged it themselves.
const ALERT_WITH_NODE =
  '*, sensor_nodes(node_identifier), acknowledged_by_profile:profiles(full_name)'

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
    acknowledgeAlert,
    getRecentReadings,
    getGlobalThresholds,
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

// Open alerts newest first, or with `acknowledged: true` the most recently acknowledged ones
async function getAlerts({ acknowledged = false } = {}) {
  let query = supabase.from('alerts').select(ALERT_WITH_NODE).eq('is_acknowledged', acknowledged)

  query = acknowledged
    ? query.order('acknowledged_at', { ascending: false }).limit(ACKNOWLEDGED_ALERTS_LIMIT)
    : query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return { data: [], error: sensorErrorMessage(error) }
  return { data, error: null }
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
