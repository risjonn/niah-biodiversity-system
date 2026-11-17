import { useCallback, useEffect, useState } from 'react'
import { Grid, Stack } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined'
import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import PageHeader from '../components/PageHeader'
import ChartCard from '../components/ChartCard'
import RecentActivity from '../components/RecentActivity'
import RecordsByMonthBars from '../components/RecordsByMonthBars'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { useNavCounts } from '../context/NavCountsContext'
import { usePlants } from '../hooks/usePlants'
import { useReports } from '../hooks/useReports'
import { useSensors } from '../hooks/useSensors'
import { useSpecies } from '../hooks/useSpecies'
import { chartTick, chartTooltipProps, chartValueLabel, formatCount } from '../lib/chartStyles'
import { conservationStatusLabels } from '../lib/conservationStatus'
import { formatLongDate, sarawakHourOf } from '../lib/formatDateTime'
import { lastMonthKeys, monthlyRowsFromReport, STACKED_REVIEW_STATUSES } from '../lib/recordMonths'
import { formatMonth } from '../lib/reportExport'
import { reviewStatusLabels } from '../lib/reviewStatus'
import { chartTokens } from '../theme/theme'

const MONTHS_SHOWN = 12

// Recharts doesn't draw a bar with a value of 0, and so doesn't draw its value label either. Every
// status must show its value, so a 0 is drawn as a sliver on the baseline with "0" beside it.
const ZERO_BAR_SIZE = 2

// "Good morning" before noon, "Good afternoon" until 6 pm, "Good evening" after, in Sarawak time
// whatever the viewer's own timezone is
function greeting(now) {
  const hour = sarawakHourOf(now)
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Officers and admins see the same dashboard
export default function Dashboard() {
  const { fullName } = useAuth()
  // The sidebar's pending reviews count, not queried again
  const { counts } = useNavCounts()
  // Fixed for this visit, so the greeting and date don't change while the page is open
  const [now] = useState(() => Date.now())
  const firstName = fullName?.trim().split(/\s+/)[0]
  const { countApprovedPlants } = usePlants()
  const { countSpecies, countSpeciesByConservationStatus } = useSpecies()
  const { countOpenAlerts } = useSensors()
  const { fetchRecordsByMonth } = useReports()

  // One call with no date range feeds both record charts: the last 12 months for the monthly
  // chart, and every month added up for the all-time review status breakdown
  const loadRecordCharts = useCallback(async () => {
    const result = await fetchRecordsByMonth({})
    if (result.error) return { data: null, error: result.error }
    return {
      data: {
        months: monthlyRowsFromReport(result.data, lastMonthKeys(MONTHS_SHOWN)),
        statusTotals: toStatusTotals(result.data),
      },
      error: null,
    }
  }, [fetchRecordsByMonth])

  const recordCharts = useLoaded(loadRecordCharts)
  const conservation = useLoaded(countSpeciesByConservationStatus)

  // Approved records among those recorded this month (Sarawak time), from the records-by-month
  // report the charts below already load. Null until it's back, or if it failed.
  const approvedThisMonth = recordCharts?.data?.months.at(-1)?.approved ?? null

  return (
    <Stack spacing={4}>
      <PageHeader
        title={firstName ? `${greeting(now)}, ${firstName}` : greeting(now)}
        subtitle={formatLongDate(now)}
      />

      <Grid container spacing={3}>
        {/* The sidebar badge's count (NavCountsContext), not a query of its own, so the two
            always match */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            icon={FactCheckOutlinedIcon}
            color="warning"
            label="Pending reviews for you"
            caption="Records by other people"
            to="/review"
            loading={counts.pendingReviews == null && !counts.errors.pendingReviews}
            error={counts.errors.pendingReviews}
            value={counts.pendingReviews == null ? null : formatCount(counts.pendingReviews)}
          />
        </Grid>
        <CountCard
          title="Approved plants"
          caption="Visible to the public"
          // Plant records with the Approved filter on
          to="/records?status=approved"
          icon={CheckCircleOutlineIcon}
          color="success"
          loadCount={countApprovedPlants}
          trend={approvedThisMonth > 0 ? `+${formatCount(approvedThisMonth)} new this month` : null}
        />
        <CountCard
          title="Species"
          caption="In the catalogue"
          to="/species"
          icon={LocalFloristOutlinedIcon}
          color="secondary"
          loadCount={countSpecies}
        />
        <CountCard
          title="Open alerts"
          caption="Not yet acknowledged"
          to="/sensors"
          icon={NotificationsActiveOutlinedIcon}
          color="error"
          loadCount={countOpenAlerts}
        />
      </Grid>

      <RecentActivity />

      <Grid container spacing={3}>
        <Grid size={12}>
          <RecordsByMonthChart result={recordCharts} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ReviewStatusChart result={recordCharts} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ConservationStatusChart result={conservation} />
        </Grid>
      </Grid>
    </Stack>
  )
}

// Runs `load` (a stable function resolving to { data, error }) and resolves to its result, or
// null while it is still loading. Each card and chart loads on its own, so a slow or failed query
// doesn't hold up the others.
function useLoaded(load) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    load().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  return result
}

// A clickable card showing one total, loaded on its own
function CountCard({ title, caption, to, icon, color, loadCount, trend }) {
  const result = useLoaded(loadCount)

  return (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <StatCard
        icon={icon}
        color={color}
        label={title}
        caption={caption}
        to={to}
        trend={trend}
        loading={!result}
        error={result?.error ?? null}
        value={result && !result.error ? formatCount(result.data) : null}
      />
    </Grid>
  )
}

// Plant records per month for the last 12 months, stacked by review status
function RecordsByMonthChart({ result }) {
  const months = result?.data?.months ?? []
  const subtitle =
    months.length > 0
      ? `Last ${MONTHS_SHOWN} months, ${formatMonth(months[0].month)} to ${formatMonth(months[months.length - 1].month)}`
      : `Last ${MONTHS_SHOWN} months`

  return (
    <ChartCard
      title="Records per month"
      subtitle={subtitle}
      loading={!result}
      error={result?.error}
      empty={months.every((row) => row.total === 0)}
      emptyMessage={`No plant records in the last ${MONTHS_SHOWN} months.`}
    >
      <RecordsByMonthBars data={months} />
    </ChartCard>
  )
}

// Every plant record by review status, one labelled bar each
function ReviewStatusChart({ result }) {
  const rows = result?.data?.statusTotals ?? []

  return (
    <ChartCard
      title="Review status"
      subtitle="All plant records"
      loading={!result}
      error={result?.error}
      empty={rows.every((row) => row.count === 0)}
      emptyMessage="No plant records yet."
    >
      <StatusBarChart
        rows={rows}
        colors={chartTokens.reviewStatus}
        labels={reviewStatusLabels}
        labelWidth={110}
      />
    </ChartCard>
  )
}

// Species per conservation status, least concern to critically endangered
function ConservationStatusChart({ result }) {
  const rows = result?.data ?? []

  return (
    <ChartCard
      title="Species by conservation status"
      subtitle="Least concern to critically endangered"
      loading={!result}
      error={result?.error}
      empty={rows.every((row) => row.count === 0)}
      emptyMessage="No species in the database yet."
    >
      <StatusBarChart
        rows={rows}
        colors={chartTokens.conservationStatus}
        labels={conservationStatusLabels}
        labelWidth={150}
      />
    </ChartCard>
  )
}

// Horizontal bars, one per { status, count } row in the order given, coloured by status and
// with every value labelled at the end of its bar. Status names sit on the left, so the long
// conservation status names fit without wrapping.
function StatusBarChart({ rows, colors, labels, labelWidth }) {
  const data = rows.map((row) => ({ ...row, label: labels[row.status] ?? row.status }))

  return (
    <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
      {/* Every bar is labelled with its value, so the value axis would only repeat them */}
      <XAxis type="number" hide allowDecimals={false} />
      <YAxis
        type="category"
        dataKey="label"
        width={labelWidth}
        tick={chartTick}
        stroke={chartTokens.axis}
        tickLine={false}
      />
      <Tooltip {...chartTooltipProps} />
      <Bar
        dataKey="count"
        name="Total"
        maxBarSize={36}
        minPointSize={ZERO_BAR_SIZE}
        radius={[0, chartTokens.barRadius, chartTokens.barRadius, 0]}
      >
        {data.map((row) => (
          <Cell key={row.status} fill={colors[row.status] ?? chartTokens.other} />
        ))}
        <LabelList dataKey="count" position="right" formatter={formatCount} {...chartValueLabel} />
      </Bar>
    </BarChart>
  )
}

// Every month added up into one { status, count } row per review status
function toStatusTotals(reportRows) {
  return STACKED_REVIEW_STATUSES.map((status) => ({
    status,
    count: reportRows.reduce((sum, row) => sum + Number(row[status] ?? 0), 0),
  }))
}
