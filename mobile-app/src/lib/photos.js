import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

// The most photos a plant record can have (plant_photos positions 0 to 4, database/schema/017)
export const MAX_PHOTOS = 5

// Photos are shrunk to this longest side and re-encoded before they are kept
const MAX_PHOTO_SIDE = 1600
const JPEG_QUALITY = 0.8

// Resizes a photo so its longest side is at most MAX_PHOTO_SIDE and saves it as a new JPEG in the
// cache folder. Resolves to { uri, width, height } for that copy; callers keep and upload only the
// copy, never the original.
// Always re-encodes, even when no resize is needed: the new JPEG is written from the pixels alone
// (Bitmap.compress on Android, UIImage.jpegData on iOS), so none of the original's metadata, such
// as the GPS position, is copied into it. As a check on that, the copy is read back and refused if
// it still carries a location. Rejects if the photo can't be prepared.
export async function preparePhoto(uri) {
  const original = await ImageManipulator.manipulate(uri).renderAsync()
  let image = original
  if (Math.max(original.width, original.height) > MAX_PHOTO_SIDE) {
    image = await ImageManipulator.manipulate(original)
      .resize(
        original.width >= original.height ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE },
      )
      .renderAsync()
  }
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG })

  const file = new File(saved.uri)
  if (jpegHasLocation(await file.bytes())) {
    file.delete()
    throw new Error('The prepared photo still carries a location')
  }
  return { uri: saved.uri, width: saved.width, height: saved.height }
}

// Whether a JPEG's metadata segments hold a location: an EXIF block with a GPS section (tag
// 0x8825 in its first directory), or XMP with GPS fields. Only the segments before the image data
// are read. Anything that isn't a well-formed JPEG header counts as no location.
export function jpegHasLocation(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false

  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false
    const marker = bytes[offset + 1]
    // Fill bytes, and markers with no length after them
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2
      continue
    }
    // Start of the image data, or the end: metadata only ever comes before these
    if (marker === 0xda || marker === 0xd9) return false

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const start = offset + 4
    const end = Math.min(offset + 2 + length, bytes.length)
    if (marker === 0xe1) {
      if (startsWith(bytes, start, 'Exif\0\0') && exifHasGps(bytes, start + 6, end)) return true
      if (startsWith(bytes, start, 'http://ns.adobe.com/xap/') && textIncludes(bytes, start, end, 'GPSLatitude')) {
        return true
      }
    }
    offset += 2 + length
  }
  return false
}

// The TIFF structure inside an EXIF segment, from `tiff` up to `end`
function exifHasGps(bytes, tiff, end) {
  if (tiff + 8 > end) return false
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d
  if (!little && !big) return false
  const read16 = (at) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1])
  const read32 = (at) =>
    little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

  const directory = tiff + read32(tiff + 4)
  if (directory + 2 > end) return false
  const entries = read16(directory)
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > end) return false
    if (read16(entry) === 0x8825) return true
  }
  return false
}

function startsWith(bytes, at, text) {
  for (let index = 0; index < text.length; index++) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false
  }
  return true
}

function textIncludes(bytes, start, end, text) {
  for (let at = start; at + text.length <= end; at++) {
    if (startsWith(bytes, at, text)) return true
  }
  return false
}
