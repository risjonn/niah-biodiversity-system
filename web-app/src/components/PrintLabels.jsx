import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Box, GlobalStyles } from '@mui/material'
import QrCode from './QrCode'
import { tokens } from '../theme/theme'

const PRINT_ROOT_ID = 'print-labels'

// Plant tag labels for printing: the QR code, the code, the scientific name and "Niah National
// Park". While mounted it opens the browser's print dialog once, and calls onDone when printing
// finishes or is cancelled. On screen nothing shows; in print only the labels do (the app, the
// sidebar and any open drawer are hidden).
//
// `labels` is [{ qrCode, scientificName }]. They are laid out on A4 in a 3 x 4 grid of cut-out
// cells (12 to a page); more than 12 carry on to the next page.
export default function PrintLabels({ labels, onDone }) {
  const printed = useRef(false)

  useEffect(() => {
    // Once only (React's strict mode runs effects twice in development)
    if (printed.current) return undefined
    printed.current = true
    window.addEventListener('afterprint', onDone, { once: true })
    // After this render is on the page, so the labels are in what gets printed
    const timer = setTimeout(() => window.print(), 0)
    return () => clearTimeout(timer)
  }, [onDone])

  // Not removed on unmount: afterprint (once) removes itself, and onDone unmounts this
  return createPortal(
    <>
      <GlobalStyles
        styles={{
          [`@media screen`]: { [`#${PRINT_ROOT_ID}`]: { display: 'none !important' } },
          [`@media print`]: {
            '@page': { size: 'A4 portrait', margin: '12mm' },
            // Everything but the labels: the app root, drawers, dialogs, snackbars
            [`body > *:not(#${PRINT_ROOT_ID})`]: { display: 'none !important' },
            body: { background: 'none !important' },
          },
        }}
      />
      <Box
        id={PRINT_ROOT_ID}
        sx={{
          display: 'grid',
          // One label is centred at the top of the page; several fill a 3-column grid
          gridTemplateColumns: labels.length === 1 ? '62mm' : 'repeat(3, 62mm)',
          gridAutoRows: '66mm',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          color: tokens.textPrimary,
        }}
      >
        {labels.map((label) => (
          <Box
            key={label.qrCode}
            sx={{
              // A dashed edge to cut along
              border: `0.3mm dashed ${tokens.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1.5mm',
              breakInside: 'avoid',
              textAlign: 'center',
              px: '3mm',
            }}
          >
            <QrCode value={label.qrCode} size="38mm" />
            <Box sx={{ fontSize: '12pt', fontWeight: 600, letterSpacing: '0.02em' }}>
              {label.qrCode}
            </Box>
            <Box sx={{ fontSize: '10pt', fontStyle: 'italic', lineHeight: 1.2 }}>
              {label.scientificName ?? 'Unknown species'}
            </Box>
            <Box sx={{ fontSize: '8pt', color: tokens.textSecondary }}>Niah National Park</Box>
          </Box>
        ))}
      </Box>
    </>,
    document.body,
  )
}
