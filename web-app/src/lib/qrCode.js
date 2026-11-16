import QRCode from 'qrcode'
import { tokens } from '../theme/theme'

// Plant tag QR codes, made in the browser (no outside QR service). They must scan the same as the
// tags the mobile app shows, so the encoding matches mobile-app exactly:
// - the same encoder: react-native-qrcode-svg uses the `qrcode` package, and package.json pins the
//   same version here (1.5.4)
// - the same value: the plant's qr_code text as it is, e.g. "NIAH-3FA9C2" (database/schema/002)
// - the same error correction: react-native-qrcode-svg's default, M
// Only the drawing differs (size, the quiet zone round the code), which doesn't change what it reads.
const ERROR_CORRECTION_LEVEL = 'M'

// The quiet zone the QR standard asks for round a printed or downloaded code, in modules
export const QR_MARGIN = 4

// Dark and light modules, the same colours as the mobile app's tag
const DARK = tokens.textPrimary
const LIGHT = tokens.surfaceWhite

// { size, isDark(row, col) } for `value`, the same matrix the mobile app draws
export function qrMatrix(value) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: ERROR_CORRECTION_LEVEL })
  return { size: modules.size, isDark: (row, col) => Boolean(modules.get(row, col)) }
}

// The dark modules as one SVG path, in module units, offset by `margin`
export function qrPath(value, margin = QR_MARGIN) {
  const { size, isDark } = qrMatrix(value)
  let path = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isDark(row, col)) path += `M${col + margin},${row + margin}h1v1h-1z`
    }
  }
  return { path, viewBox: size + margin * 2 }
}

export const QR_COLOURS = { dark: DARK, light: LIGHT }

// Downloads the code as a PNG named after it, e.g. "NIAH-3FA9C2.png". Drawn on a canvas in the
// browser and saved through a temporary object URL, so nothing leaves the page.
export function downloadQrPng(value, { pixelsPerModule = 16 } = {}) {
  const { size, isDark } = qrMatrix(value)
  const side = (size + QR_MARGIN * 2) * pixelsPerModule
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  context.fillStyle = LIGHT
  context.fillRect(0, 0, side, side)
  context.fillStyle = DARK
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isDark(row, col)) {
        context.fillRect(
          (col + QR_MARGIN) * pixelsPerModule,
          (row + QR_MARGIN) * pixelsPerModule,
          pixelsPerModule,
          pixelsPerModule,
        )
      }
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The QR code image could not be created.'))
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${value}.png`
      document.body.append(link)
      link.click()
      link.remove()
      // Kept for a minute: the browser reads the blob after the click returns, and revoking it
      // straight away can cut the download off (seen in Chrome)
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000)
      resolve()
    }, 'image/png')
  })
}
