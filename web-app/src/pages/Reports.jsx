import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined'
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import TableSkeleton from '../components/TableSkeleton'
import { useToast } from '../context/ToastContext'
import { useReports } from '../hooks/useReports'
import { conservationStatusChipColor, conservationStatusLabels } from '../lib/conservationStatus'
import {
  downloadCsv,
  downloadReportPdf,
  recordsByMonthReport,
  reportFilename,
  sensorSummaryReport,
  speciesSummaryReport,
} from '../lib/reportExport'

const COUNT_KEYS = ['total_records', 'approved', 'pending_review', 'rejected']

// Colours match the review status chips and charts
const SUMMARY_CARDS = [
  { key: 'total_records', label: 'Total records', icon: ListAltOutlinedIcon, color: 'primary' },
  { key: 'approved', label: 'Approved', icon: CheckCircleOutlineIcon, color: 'success' },
  { key: 'pending_review', label: 'Pending review', icon: HourglassEmptyOutlinedIcon, color: 'warning' },
  { key: 'rejected', label: 'Rejected', icon: CancelOutlinedIcon, color: 'error' },
]

// Page-only cell styling. The exports use each column's plain format() value instead.
const speciesRenderers = {
  scientific_name: (row) => (
    <Box component="span" sx={{ fontStyle: 'italic' }}>
      {row.scientific_name}
    </Box>
  ),
  conservation_status: (row) =>
    row.conservation_status ? (
      <Chip
        size="small"
        label={conservationStatusLabels[row.conservation_status] ?? row.conservation_status}
        color={conservationStatusChipColor(row.conservation_status)}
      />
    ) : (
      '—'
    ),
}

export default function Reports() {
  const { fetchSpeciesSummary, fetchRecordsByMonth, fetchSensorSummary } = useReports()
  // Inclusive 'YYYY-MM-DD' days from the date pickers, '' when left empty
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Each result is kept with the range it was fetched for, so a section shows as loading (rather
  // than showing the previous range's rows) until its own query for the current range is back
  const [results, setResults] = useState({})
  const [pdfBusy, setPdfBusy] = useState(false)
  const toast = useToast()

  const rangeInvalid = Boolean(from && to && from > to)
  const rangeKey = `${from}|${to}`
  const range = { from: from || null, to: to || null }

  useEffect(() => {
    if (rangeInvalid) return undefined

    let cancelled = false
    const key = `${from}|${to}`
    const reportRange = { from: from || null, to: to || null }
    // Each section fills in as soon as its own query is back
    const fetches = {
      species: fetchSpeciesSummary,
      months: fetchRecordsByMonth,
      sensors: fetchSensorSummary,
    }
    for (const [name, fetchReport] of Object.entries(fetches)) {
      fetchReport(reportRange).then((result) => {
        if (!cancelled) setResults((current) => ({ ...current, [name]: { ...result, key } }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [from, to, rangeInvalid, fetchSpeciesSummary, fetchRecordsByMonth, fetchSensorSummary])

  const resultFor = (name) => (results[name]?.key === rangeKey ? results[name] : null)
  const species = resultFor('species')
  const months = resultFor('months')
  const sensors = resultFor('sensors')
  const anyLoading = !species || !months || !sensors
  const anyError = Boolean(species?.error || months?.error || sensors?.error)

  const totals = species && !species.error ? sumCounts(species.data) : null

  function clearDates() {
    setFrom('')
    setTo('')
  }

  function handleExportCsv(report, rows) {
    try {
      downloadCsv(reportFilename(report.filePrefix, range, 'csv'), report.columns, rows)
    } catch {
      toast.error('The CSV file could not be created. Try again.')
    }
  }

  async function handleDownloadPdf() {
    setPdfBusy(true)
    try {
      await downloadReportPdf({
        ...range,
        speciesRows: species.data,
        monthRows: months.data,
        sensorRows: sensors.data,
      })
    } catch {
      // Also covers the PDF library failing to load, e.g. when the connection drops
      toast.error('The PDF report could not be created. Try again.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Reports"
        subtitle="Plant records and sensor activity for a period, ready to export as CSV or PDF"
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          {/* The hint sits below the row, not as helperText, so both date boxes stay the same
              height and line up with the buttons */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
            useFlexGap
          >
            <TextField
              type="date"
              label="From"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              error={rangeInvalid}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="To"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              error={rangeInvalid}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button onClick={clearDates} disabled={!from && !to}>
              Clear dates
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="contained"
              onClick={handleDownloadPdf}
              loading={pdfBusy}
              // A failed section would read as "No data" in the PDF, so wait until all three loaded
              disabled={rangeInvalid || anyLoading || anyError}
            >
              Download PDF report
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Both dates are included.
          </Typography>
        </Stack>
      </Paper>

      {rangeInvalid ? (
        <Alert severity="error">The From date must be on or before the To date.</Alert>
      ) : (
        <>
          <Grid container spacing={2}>
            {SUMMARY_CARDS.map((card) => (
              <Grid key={card.key} size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                  icon={card.icon}
                  color={card.color}
                  label={card.label}
                  loading={!species}
                  value={totals ? totals[card.key].toLocaleString() : '—'}
                />
              </Grid>
            ))}
          </Grid>

          <ReportSection
            report={speciesSummaryReport}
            result={species}
            emptyText="No plant records for this period"
            renderers={speciesRenderers}
            totalsRow={totals}
            onExport={() => handleExportCsv(speciesSummaryReport, species.data)}
          />
          <ReportSection
            report={recordsByMonthReport}
            result={months}
            emptyText="No plant records for this period"
            onExport={() => handleExportCsv(recordsByMonthReport, months.data)}
          />
          <ReportSection
            report={sensorSummaryReport}
            result={sensors}
            emptyText="No sensor nodes yet"
            onExport={() => handleExportCsv(sensorSummaryReport, sensors.data)}
          />
        </>
      )}

    </Stack>
  )
}

// One report: heading, CSV export, then a spinner, error, empty text or the table. `result` is
// null while loading.
function ReportSection({ report, result, emptyText, renderers = {}, totalsRow, onExport }) {
  const rows = result?.data ?? []
  const canExport = Boolean(result && !result.error && rows.length > 0)
  const { columns } = report

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography variant="h2">{report.title}</Typography>
          <Button variant="outlined" onClick={onExport} disabled={!canExport}>
            Export CSV
          </Button>
        </Stack>

        {!result ? (
          <TableSkeleton
            columns={columns.map((column) => column.label)}
            label={`Loading ${report.title.toLowerCase()}`}
            size="small"
            rows={3}
            outlined={false}
          />
        ) : null}
        {result?.error ? <Alert severity="error">{result.error}</Alert> : null}
        {result && !result.error && rows.length === 0 ? (
          <EmptyState message={emptyText} dense />
        ) : null}

        {canExport ? (
          // Wide reports scroll sideways inside the section instead of stretching the page
          <TableContainer sx={{ overflowX: 'auto' }}>
            {/* 8px side padding instead of 16px: with ten columns that is what lets the species
                summary fit at 1280px */}
            <Table size="small" sx={{ '& .MuiTableCell-root': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  {/* Long headings ("Conservation status") may wrap, so the species summary fits
                      at 1280px without scrolling sideways. Dates and numbers stay on one line. */}
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      align={column.numeric ? 'right' : 'left'}
                      sx={{ verticalAlign: 'bottom' }}
                    >
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={rowKey(row, index)}>
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        align={column.numeric ? 'right' : 'left'}
                        sx={column.noWrap ? { whiteSpace: 'nowrap' } : undefined}
                      >
                        {renderers[column.key]
                          ? renderers[column.key](row)
                          : displayValue((column.display ?? column.format)(row))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {totalsRow ? (
                  <TableRow>
                    {columns.map((column, index) => (
                      <TableCell
                        key={column.key}
                        align={column.numeric ? 'right' : 'left'}
                        // Semibold like the headings; the design system doesn't use 700
                        sx={{ fontWeight: (theme) => theme.typography.h2.fontWeight }}
                      >
                        {index === 0 ? 'Total' : totalsCell(totalsRow, column.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </Stack>
    </Paper>
  )
}

function rowKey(row, index) {
  return row.species_id ?? row.sensor_node_id ?? row.record_month ?? index
}

function displayValue(value) {
  if (value == null) return '—'
  return typeof value === 'number' ? value.toLocaleString('en-MY') : value
}

function totalsCell(totals, key) {
  return key in totals ? totals[key].toLocaleString('en-MY') : ''
}

function sumCounts(rows) {
  return Object.fromEntries(
    COUNT_KEYS.map((key) => [key, rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0)]),
  )
}
