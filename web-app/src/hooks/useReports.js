import { supabase } from '../lib/supabaseClient'
import { queryErrorMessage } from '../lib/queryHelpers'

// The plants and sensors are in Niah, so a report day runs midnight to midnight Sarawak time
const SARAWAK_OFFSET = '+08:00'

// Report queries for the reports page, from database/schema/012_reporting_functions.sql. Each
// takes { from, to } as inclusive 'YYYY-MM-DD' strings (or null for no limit) and resolves to
// { data, error } without throwing, the same pattern as usePlants.
export function useReports() {
  return { fetchSpeciesSummary, fetchRecordsByMonth, fetchSensorSummary }
}

// One row per species with its plant record counts by review status
function fetchSpeciesSummary(range) {
  return callReport('report_species_summary', range)
}

// One row per month (Sarawak time); record_month is a 'YYYY-MM-DD' date string
function fetchRecordsByMonth(range) {
  return callReport('report_records_by_month', range)
}

// One row per sensor node with reading statistics and alert counts
function fetchSensorSummary(range) {
  return callReport('report_sensor_summary', range)
}

async function callReport(name, { from, to } = {}) {
  const { data, error } = await supabase.rpc(name, toReportRange({ from, to }))
  if (error) return { data: [], error: reportErrorMessage(error) }
  return { data: data ?? [], error: null }
}

// The functions take p_to as exclusive, so the inclusive `to` day becomes the start of the next one
function toReportRange({ from, to }) {
  return {
    p_from: from ? `${from}T00:00:00${SARAWAK_OFFSET}` : null,
    p_to: to ? `${nextDay(to)}T00:00:00${SARAWAK_OFFSET}` : null,
  }
}

// Worked out in UTC so the browser's own timezone can't move the date
function nextDay(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function reportErrorMessage(error) {
  if (error.code === '42501') return 'Your account is not allowed to view reports.'
  return queryErrorMessage(error)
}
