import { createPortal } from 'react-dom'
import { Box, GlobalStyles } from '@mui/material'
import QrCode from './QrCode'
import { tokens } from '../theme/theme'

const PRINT_ROOT_ID = 'print-labels'

// Printed sizes. The QR is 40 mm square including its 4-module quiet zone. A4 is 210 x 297 mm;
// with a 10 mm page margin that leaves 190 x 277 mm: 3 columns of 62 mm (186 mm) and 4 rows of
// 68 mm (272 mm), so 12 labels to a page.
const QR_SIZE = '40mm'
const CELL_WIDTH = '62mm'
const CELL_HEIGHT = '68mm'
const PAGE_MARGIN = '10mm'
// Smallest text: "Niah National Park" at 8 pt, the scientific name at 10 pt (at least 9 pt)
const CODE_SIZE = '12pt'
const NAME_SIZE = '10pt'
const PARK_SIZE = '8pt'

// Plant tag labels for printing: the QR code, the code, the scientific name and "Niah National
// Park". Only lays them out: printing is started by usePrintLabels (hooks/usePrintLabels.jsx),
// straight from the click. On screen nothing shows; in print only the labels do (the app, the
// sidebar and any open drawer are hidden).
//
// `labels` is [{ qrCode, scientificName }]. They are laid out on A4 in a 3 x 4 grid of cut-out
// cells (12 to a page); more than 12 carry on to the next page.
export default function PrintLabels({ labels }) {
  return createPortal(
    <>
      <GlobalStyles
        styles={{
          [`@media screen`]: { [`#${PRINT_ROOT_ID}`]: { display: 'none !important' } },
          [`@media print`]: {
            '@page': { size: 'A4 portrait', margin: PAGE_MARGIN },
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
          gridTemplateColumns: labels.length === 1 ? CELL_WIDTH : `repeat(3, ${CELL_WIDTH})`,
          gridAutoRows: CELL_HEIGHT,
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
              overflow: 'hidden',
            }}
          >
            <QrCode value={label.qrCode} size={QR_SIZE} />
            <Box sx={{ fontSize: CODE_SIZE, fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1.2 }}>
              {label.qrCode}
            </Box>
            <Box sx={{ fontSize: NAME_SIZE, fontStyle: 'italic', lineHeight: 1.2 }}>
              {label.scientificName ?? 'Unknown species'}
            </Box>
            <Box sx={{ fontSize: PARK_SIZE, color: tokens.textSecondary, lineHeight: 1.2 }}>
              Niah National Park
            </Box>
          </Box>
        ))}
      </Box>
    </>,
    document.body,
  )
}
