import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Sensor alerts for conservation officers and admins, through the same queries the web sensors
// page uses (web-app/src/hooks/useSensors.js). RLS: alerts, sensor_nodes and sensor_readings are
// readable by staff only (001), device_alert_codes too (018), and staff can update an open alert
// only to acknowledge it themselves (010), with guard_alert_updates (018) refusing any other
// column. Every function resolves to { data, error } and never throws; `error` is a message ready
// to show.

// Each alert comes with its node's identifier and installed position, the name of whoever
// acknowledged it (profiles are readable only by their owner and admins, so for an officer this
// is null unless they acknowledged it themselves), its code's meaning for a device alert, and the
// reading that raised it as `reading` (null for alerts without one)
const ALERT_SELECT =
  '*, sensor_nodes(node_identifier, latitude, longitude), ' +
  'acknowledged_by_profile:profiles(full_name), ' +
  'device_alert_code:device_alert_codes(description), ' +
  'reading:sensor_readings(temperature, humidity, motion_duration_seconds, latitude, longitude)'

// The acknowledged list is history, so only the most recent ones are loaded
const ACKNOWLEDGED_LIMIT = 20

export function useAlerts() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Marks an open alert as acknowledged by the signed-in user. Sends only the three
  // acknowledgement columns, the only ones guard_alert_updates (018) lets staff change.
  async function acknowledgeAlert(id) {
    if (!userId) return { data: null, error: 'You need to be signed in to acknowledge alerts.' }

    const { data, error } = await supabase
      .from('alerts')
      .update({
        is_acknowledged: true,
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', id)
      // Only open alerts, so two officers can't both acknowledge it; the 010 policy says the same
      .eq('is_acknowledged', false)
      .select('id')
      .maybeSingle()

    if (error) return { data: null, error: alertErrorMessage(error) }
    // RLS hides rows the user can't change instead of raising an error, so no row means someone
    // else acknowledged it first
    if (!data) return { data: null, error: 'This alert has already been acknowledged.' }
    return { data, error: null }
  }

  return { fetchOpenAlerts, fetchAcknowledgedAlerts, acknowledgeAlert }
}

// Every open alert, newest first
async function fetchOpenAlerts() {
  const { data, error } = await supabase
    .from('alerts')
    .select(ALERT_SELECT)
    .eq('is_acknowledged', false)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: alertErrorMessage(error) }
  return { data, error: null }
}

// The most recently acknowledged alerts
async function fetchAcknowledgedAlerts() {
  const { data, error } = await supabase
    .from('alerts')
    .select(ALERT_SELECT)
    .eq('is_acknowledged', true)
    .order('acknowledged_at', { ascending: false })
    .limit(ACKNOWLEDGED_LIMIT)

  if (error) return { data: [], error: alertErrorMessage(error) }
  return { data, error: null }
}

function alertErrorMessage(error) {
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Unable to reach the server. Check your connection and try again.'
    case '42501':
      return 'Your account is not allowed to do this.'
    // guard_alert_updates (018) refused the update
    case 'P0001':
      return 'Only acknowledging an alert is allowed.'
    default:
      return error.message
  }
}
