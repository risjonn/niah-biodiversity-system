// The format generate_plant_qr_code (database/schema/002) prints on plant tags
export const QR_CODE_PATTERN = /^NIAH-[0-9A-F]{6}$/

export const normaliseQrCode = (raw) => String(raw ?? '').trim().toUpperCase()