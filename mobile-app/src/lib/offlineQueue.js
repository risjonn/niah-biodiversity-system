import { randomUUID } from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import * as SQLite from 'expo-sqlite'

// Plant records saved on the phone before they reach the server (the outbox). Every registration
// is queued here first and then synced by lib/syncQueue.js. The database lives in the app's
// documents storage (expo-sqlite's default folder), which the OS never clears.
const DATABASE_NAME = 'niah-offline.db'

// Queued photos are copied here from the cache folder, which the OS can clear at any time.
// Paths are stored relative to the documents folder because iOS moves the app's container when
// the app is updated, which would break a saved absolute path.
const PHOTO_FOLDER = 'offline-photos'

// Synced records are kept until their QR code has been shown in My Records, or this long
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS queued_plants (
    id                      TEXT PRIMARY KEY NOT NULL,
    user_id                 TEXT NOT NULL,
    species_id              TEXT NOT NULL,
    species_scientific_name TEXT NOT NULL,
    species_common_name     TEXT,
    height_cm               REAL,
    morphological_notes     TEXT,
    location_description    TEXT,
    latitude                REAL NOT NULL,
    longitude               REAL NOT NULL,
    recorded_at             TEXT NOT NULL,
    local_photo_path        TEXT,
    uploaded_photo_path     TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
    error_message           TEXT,
    attempts                INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL,
    qr_code                 TEXT,
    synced_at               TEXT,
    qr_shown_at             TEXT
  );
  CREATE INDEX IF NOT EXISTS queued_plants_user_status
    ON queued_plants (user_id, status, created_at);
`

const INSERT_PLANT = `
  INSERT INTO queued_plants (
    id, user_id, species_id, species_scientific_name, species_common_name, height_cm,
    morphological_notes, location_description, latitude, longitude, recorded_at,
    local_photo_path, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

let databasePromise = null

// Opened once per app launch. A failed open is retried on the next call.
function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

async function openDatabase() {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME)
  await db.execAsync('PRAGMA journal_mode = WAL;')

  const { user_version: version } = await db.getFirstAsync('PRAGMA user_version')
  if (version < 1) {
    await db.execAsync(`BEGIN; ${SCHEMA} PRAGMA user_version = 1; COMMIT;`)
  }

  // Runs before any sync can start, so anything still marked syncing was cut off by the app closing
  await db.runAsync("UPDATE queued_plants SET status = 'pending' WHERE status = 'syncing'")
  await deleteFinishedRecords(db)
  await deleteOrphanPhotos(db)
  return db
}

// Queues one plant record and resolves to its queued row. Rejects if it couldn't be saved, in
// which case nothing was queued.
//   plant: { userId, species: { id, scientific_name, common_name }, height_cm, morphological_notes,
//            location_description, latitude, longitude, recorded_at, photoUri }
export async function queuePlant(plant) {
  const [row] = await queuePlants([plant])
  return row
}

// Queues several records in one transaction: either all of them are queued or none are
export async function queuePlants(plants) {
  const db = await getDatabase()
  const createdAt = new Date().toISOString()
  const rows = []

  try {
    for (const plant of plants) {
      const id = randomUUID()
      rows.push({
        id,
        plant,
        photoPath: plant.photoUri ? await copyPhoto(id, plant.photoUri) : null,
      })
    }

    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const { id, plant, photoPath } of rows) {
        await txn.runAsync(INSERT_PLANT, [
          id,
          plant.userId,
          plant.species.id,
          plant.species.scientific_name,
          plant.species.common_name ?? null,
          plant.height_cm ?? null,
          plant.morphological_notes ?? null,
          plant.location_description ?? null,
          plant.latitude,
          plant.longitude,
          plant.recorded_at,
          photoPath,
          createdAt,
        ])
      }
    })
  } catch (error) {
    for (const { photoPath } of rows) deletePhoto(photoPath)
    throw error
  }

  const ids = rows.map((row) => row.id)
  return db.getAllAsync(
    `SELECT * FROM queued_plants WHERE id IN (${placeholders(ids)}) ORDER BY created_at, rowid`,
    ids,
  )
}

// Every queued record for this user, oldest first
export async function getQueuedPlants(userId) {
  const db = await getDatabase()
  return db.getAllAsync(
    'SELECT * FROM queued_plants WHERE user_id = ? ORDER BY created_at, rowid',
    [userId],
  )
}

export async function getNextPendingPlant(userId) {
  const db = await getDatabase()
  return db.getFirstAsync(
    `SELECT * FROM queued_plants WHERE user_id = ? AND status = 'pending'
     ORDER BY created_at, rowid LIMIT 1`,
    [userId],
  )
}

export async function markSyncing(id) {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE queued_plants SET status = 'syncing', attempts = attempts + 1 WHERE id = ?",
    [id],
  )
}

// Back to waiting after a network error; `message` is kept for reference, not shown
export async function markPending(id, message) {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE queued_plants SET status = 'pending', error_message = ? WHERE id = ?",
    [message ?? null, id],
  )
}

// `message` is ready to show on screen
export async function markFailed(id, message) {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE queued_plants SET status = 'failed', error_message = ? WHERE id = ?",
    [message, id],
  )
}

export async function setUploadedPhotoPath(id, path) {
  const db = await getDatabase()
  await db.runAsync('UPDATE queued_plants SET uploaded_photo_path = ? WHERE id = ?', [path, id])
}

// The photo copy is deleted after the row is updated, so a crash in between only leaves a file
// that the next launch cleans up
export async function markSynced(id, qrCode) {
  const db = await getDatabase()
  const row = await db.getFirstAsync('SELECT local_photo_path FROM queued_plants WHERE id = ?', [
    id,
  ])
  await db.runAsync(
    `UPDATE queued_plants
     SET status = 'synced', qr_code = ?, synced_at = ?, error_message = NULL,
         local_photo_path = NULL
     WHERE id = ?`,
    [qrCode, new Date().toISOString(), id],
  )
  deletePhoto(row?.local_photo_path)
}

// Puts a failed record back in line to sync
export async function retryPlant(id) {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE queued_plants SET status = 'pending', error_message = NULL WHERE id = ? AND status = 'failed'",
    [id],
  )
}

// Only failed records can be discarded
export async function discardPlant(id) {
  const db = await getDatabase()
  const row = await db.getFirstAsync(
    "SELECT local_photo_path FROM queued_plants WHERE id = ? AND status = 'failed'",
    [id],
  )
  if (!row) return
  await db.runAsync("DELETE FROM queued_plants WHERE id = ? AND status = 'failed'", [id])
  deletePhoto(row.local_photo_path)
}

// Synced records whose QR code My Records has shown; they are removed by the next clean-up
export async function markQrShown(ids) {
  if (ids.length === 0) return
  const db = await getDatabase()
  await db.runAsync(
    `UPDATE queued_plants SET qr_shown_at = ?
     WHERE id IN (${placeholders(ids)}) AND status = 'synced' AND qr_shown_at IS NULL`,
    [new Date().toISOString(), ...ids],
  )
}

export async function cleanUpQueue() {
  const db = await getDatabase()
  await deleteFinishedRecords(db)
}

// A queued photo as a File, from the relative path stored in local_photo_path
export function getQueuedPhoto(relativePath) {
  return new File(Paths.document, ...relativePath.split('/'))
}

async function deleteFinishedRecords(db) {
  const cutoff = new Date(Date.now() - SYNCED_RETENTION_MS).toISOString()
  await db.runAsync(
    `DELETE FROM queued_plants
     WHERE status = 'synced' AND (qr_shown_at IS NOT NULL OR synced_at < ?)`,
    [cutoff],
  )
}

// Copies left behind when the app closed between copying a photo and saving its row, or between
// syncing a record and deleting its copy
async function deleteOrphanPhotos(db) {
  try {
    const folder = new Directory(Paths.document, PHOTO_FOLDER)
    if (!folder.exists) return
    const rows = await db.getAllAsync(
      'SELECT local_photo_path FROM queued_plants WHERE local_photo_path IS NOT NULL',
    )
    const inUse = new Set(rows.map((row) => row.local_photo_path))
    for (const entry of folder.list()) {
      if (entry instanceof File && !inUse.has(`${PHOTO_FOLDER}/${entry.name}`)) entry.delete()
    }
  } catch {
    // Only tidying up; tried again on the next launch
  }
}

async function copyPhoto(id, sourceUri) {
  const folder = new Directory(Paths.document, PHOTO_FOLDER)
  folder.create({ intermediates: true, idempotent: true })
  const name = `${id}.jpg`
  await new File(sourceUri).copy(new File(folder, name))
  return `${PHOTO_FOLDER}/${name}`
}

function deletePhoto(relativePath) {
  if (!relativePath) return
  try {
    const file = getQueuedPhoto(relativePath)
    if (file.exists) file.delete()
  } catch {
    // Left for deleteOrphanPhotos on the next launch
  }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}
