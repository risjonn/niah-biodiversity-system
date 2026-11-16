import { conservationStatusLabels } from './conservationStatus'
import { formatDateTime } from './formatDateTime'
import { tokens } from '../theme/theme'

// Shared by the reports page and its CSV and PDF exports, so all three always show the same
// columns. Each column's format(row) gives a number, a string, or null for "no value"; the page
// shows null as '—' and the exports leave it empty. A column with display(row) shows that on the
// page instead, while the exports still use format(row). Numbers stay numbers (units are in the label)
// so spreadsheets can still sum them and a negative temperature isn't mistaken for a formula.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Reports are about Niah, so times read the same wherever the viewer's browser is
const kuchingDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// e.g. "16 Oct 2026, 14:30". Built from parts so it doesn't depend on how a browser punctuates en-GB.
export function formatKuchingDateTime(value) {
  if (value == null) return null
  const parts = Object.fromEntries(
    kuchingDateTime.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`
}

// 'YYYY-MM-DD' to "Oct 2026". Read straight from the string: new Date() would parse it as UTC
// midnight, which is the previous month in any timezone west of UTC.
export function formatMonth(date) {
  if (!date) return null
  const [year, month] = date.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`
}

// 'YYYY-MM-DD' to "16 Oct 2026", for the date pickers' plain calendar days
function formatDay(date) {
  const [year, month, day] = date.split('-')
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year}`
}

// Checked before Number(), which turns null into 0. PostgREST can send numeric columns as strings.
function toNumber(value) {
  return value == null ? null : Number(value)
}

function textColumn(key, label) {
  return { key, label, format: (row) => row[key] ?? null }
}

function numberColumn(key, label) {
  return { key, label, numeric: true, format: (row) => toNumber(row[key]) }
}

// format() is the export value ("16 Oct 2026, 14:30"). The page shows display() instead, in the
// app's date format ("16 Oct 2026, 2:30 pm").
function dateTimeColumn(key, label) {
  return {
    key,
    label,
    format: (row) => formatKuchingDateTime(row[key]),
    display: (row) => formatDateTime(row[key]),
  }
}

export const speciesSummaryReport = {
  title: 'Species summary',
  filePrefix: 'niah-species-summary',
  columns: [
    textColumn('scientific_name', 'Scientific name'),
    textColumn('common_name', 'Common name'),
    textColumn('family', 'Family'),
    {
      key: 'conservation_status',
      label: 'Conservation status',
      format: (row) =>
        conservationStatusLabels[row.conservation_status] ?? row.conservation_status ?? null,
    },
    numberColumn('total_records', 'Total'),
    numberColumn('approved', 'Approved'),
    numberColumn('pending_review', 'Pending'),
    numberColumn('rejected', 'Rejected'),
    dateTimeColumn('first_recorded_at', 'First recorded'),
    dateTimeColumn('last_recorded_at', 'Last recorded'),
  ],
}

export const recordsByMonthReport = {
  title: 'Records by month',
  filePrefix: 'niah-records-by-month',
  columns: [
    { key: 'record_month', label: 'Month', format: (row) => formatMonth(row.record_month) },
    numberColumn('total_records', 'Total'),
    numberColumn('approved', 'Approved'),
    numberColumn('pending_review', 'Pending'),
    numberColumn('rejected', 'Rejected'),
  ],
}

export const sensorSummaryReport = {
  title: 'Sensor summary',
  filePrefix: 'niah-sensor-summary',
  columns: [
    textColumn('node_identifier', 'Node'),
    textColumn('plant_qr_code', 'Plant QR'),
    textColumn('scientific_name', 'Species'),
    numberColumn('readings', 'Readings'),
    numberColumn('avg_temperature', 'Avg temp (°C)'),
    numberColumn('min_temperature', 'Min temp (°C)'),
    numberColumn('max_temperature', 'Max temp (°C)'),
    numberColumn('avg_humidity', 'Avg humidity (%)'),
    numberColumn('min_humidity', 'Min humidity (%)'),
    numberColumn('max_humidity', 'Max humidity (%)'),
    numberColumn('motion_events', 'Motion events'),
    numberColumn('alerts', 'Alerts'),
    numberColumn('high_alerts', 'High alerts'),
    dateTimeColumn('last_reading_at', 'Last reading'),
  ],
}

// e.g. "niah-species-summary_2026-10-01_to_today.csv" or "niah-species-summary_all-dates.csv"
export function reportFilename(prefix, { from, to }, extension) {
  const range = from || to ? `${from || 'start'}_to_${to || 'today'}` : 'all-dates'
  return `${prefix}_${range}.${extension}`
}

function describeRange({ from, to }) {
  if (from && to) return `${formatDay(from)} to ${formatDay(to)}`
  if (from) return `From ${formatDay(from)}`
  if (to) return `Up to ${formatDay(to)}`
  return 'All dates'
}

// Long enough for the browser to start the download before the URL stops working
const OBJECT_URL_LIFETIME_MS = 1000

export function downloadCsv(filename, columns, rows) {
  const lines = [
    columns.map((column) => csvField(column.label)),
    ...rows.map((row) => columns.map((column) => csvField(column.format(row)))),
  ].map((fields) => fields.join(','))

  // The BOM tells Excel the file is UTF-8, otherwise it misreads characters like ° and accents
  const blob = new Blob(['﻿', lines.join('\r\n'), '\r\n'], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking straight after click() can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS)
}

function csvField(value) {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

  let text = String(value)
  // Spreadsheets run text starting with these as a formula (CSV injection), so make it plain text
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

// Page layout in mm, A4 landscape
const PDF_MARGIN = 14
const PDF_SECTION_GAP = 12
// Below this much room left, a section heading starts on a new page instead of sitting alone
const PDF_MIN_SECTION_SPACE = 30

export async function downloadReportPdf({ from, to, speciesRows, monthRows, sensorRows }) {
  // Loaded only when someone downloads a PDF, so they stay out of the main bundle
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Niah Biodiversity Report', PDF_MARGIN, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Period: ${describeRange({ from, to })}`, PDF_MARGIN, 26)
  doc.text(`Generated: ${formatKuchingDateTime(new Date())}`, PDF_MARGIN, 32)

  const sections = [
    { report: speciesSummaryReport, rows: speciesRows },
    { report: recordsByMonthReport, rows: monthRows },
    { report: sensorSummaryReport, rows: sensorRows },
  ]

  let y = 32 + PDF_SECTION_GAP
  for (const { report, rows } of sections) {
    if (y > pageHeight - PDF_MIN_SECTION_SPACE) {
      doc.addPage()
      y = PDF_MARGIN + 4
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(report.title, PDF_MARGIN, y)

    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text('No data for this period', PDF_MARGIN, y + 7)
      y += 7 + PDF_SECTION_GAP
      continue
    }

    const { columns } = report
    autoTable(doc, {
      startY: y + 3,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [columns.map((column) => column.label)],
      body: rows.map((row) => columns.map((column) => column.format(row) ?? '')),
      styles: { font: 'helvetica', fontSize: 8, textColor: tokens.textPrimary },
      headStyles: { fillColor: tokens.primary, textColor: tokens.surfaceWhite },
      columnStyles: Object.fromEntries(
        columns.flatMap((column, index) => (column.numeric ? [[index, { halign: 'right' }]] : [])),
      ),
    })
    y = doc.lastAutoTable.finalY + PDF_SECTION_GAP
  }

  doc.save(reportFilename('niah-biodiversity-report', { from, to }, 'pdf'))
}
