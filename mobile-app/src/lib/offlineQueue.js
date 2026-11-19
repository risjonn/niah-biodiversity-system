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

// Version 1: one row per record, with at most one photo (local_photo_path, uploaded_photo_path)
const SCHEMA_V1 = `
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

// Version 2: up to 5 photos per record, one row each, and how far each record's sync has got, so
// a retry carries on from where the last attempt stopped:
// - queued_plant_photos.uploaded: the file is in storage at storage_path
// - queued_plants.plant_saved: the plant row is on the server (its qr_code is kept with it)
// - queued_plant_photos.row_saved: the photo's plant_photos row is on the server
// storage_path (<user id>/<random id>.jpg) is chosen when the photo is queued and never changes,
// so a repeated upload of the same photo finds its own file already there instead of making a
// second one.
// Records queued by version 1 are converted here, the first time the queue is opened after the
// update: a record's single photo becomes its position 0 photo, and the old columns are cleared.
const SCHEMA_V2 = `
  CREATE TABLE IF NOT EXISTS queued_plant_photos (
    plant_id     TEXT NOT NULL,
    position     INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
    local_path   TEXT,
    storage_path TEXT NOT NULL,
    uploaded     INTEGER NOT NULL DEFAULT 0,
    row_saved    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (plant_id, position)
  );
  ALTER TABLE queued_plants ADD COLUMN plant_saved INTEGER NOT NULL DEFAULT 0;

  -- Version 1 uploaded a record's photo to <user id>/<record id>.jpg, so a photo whose upload
  -- wasn't recorded (the app closed straight after it) keeps that path and is found there
  INSERT INTO queued_plant_photos (plant_id, position, local_path, storage_path, uploaded, row_saved)
  SELECT id, 0, local_photo_path,
         COALESCE(uploaded_photo_path, user_id || '/' || id || '.jpg'),
         CASE WHEN uploaded_photo_path IS NOT NULL THEN 1 ELSE 0 END,
         CASE WHEN status = 'synced' THEN 1 ELSE 0 END
  FROM queued_plants
  WHERE local_photo_path IS NOT NULL OR uploaded_photo_path IS NOT NULL;
  UPDATE queued_plants SET plant_saved = 1 WHERE status = 'synced';
  UPDATE queued_plants SET local_photo_path = NULL, uploaded_photo_path = NULL;
`

const INSERT_PLANT = `
  INSERT INTO queued_plants (
    id, user_id, species_id, species_scientific_name, species_common_name, height_cm,
    morphological_notes, location_description, latitude, longitude, recorded_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const INSERT_PHOTO = `
  INSERT INTO queued_plant_photos (plant_id, position, local_path, storage_path)
  VALUES (?, ?, ?, ?)
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

  // Each step in its own transaction, so a failed upgrade leaves the previous version intact
  const { user_version: version } = await db.getFirstAsync('PRAGMA user_version')
  if (version < 1) {
    await db.execAsync(`BEGIN; ${SCHEMA_V1} PRAGMA user_version = 1; COMMIT;`)
  }
  if (version < 2) {
    await db.execAsync(`BEGIN; ${SCHEMA_V2} PRAGMA user_version = 2; COMMIT;`)
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
//            location_description, latitude, longitude, recorded_at, photoUris }
//   photoUris: up to 5 prepared photos (lib/photos.js) in the cache folder, cover first
export async function queuePlant(plant) {
  const [row] = await queuePlants([plant])
  return row
}

// Queues several records in one transaction: either all of them are queued or none are. Each
// photo is copied into the documents folder first, so it survives the app being closed.
export async function queuePlants(plants) {
  const db = await getDatabase()
  const createdAt = new Date().toISOString()
  const rows = []
  const copied = []

  try {
    for (const plant of plants) {
      const photos = []
      for (const [position, uri] of (plant.photoUris ?? []).entries()) {
        const photoId = randomUUID()
        const localPath = await copyPhoto(photoId, uri)
        copied.push(localPath)
        photos.push({ position, localPath, storagePath: `${plant.userId}/${photoId}.jpg` })
      }
      rows.push({ id: randomUUID(), plant, photos })
    }

    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const { id, plant, photos } of rows) {
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
          createdAt,
        ])
        for (const photo of photos) {
          await txn.runAsync(INSERT_PHOTO, [id, photo.position, photo.localPath, photo.storagePath])
        }
      }
    })
  } catch (error) {
    for (const localPath of copied) deletePhoto(localPath)
    throw error
  }

  const ids = rows.map((row) => row.id)
  const queued = await db.getAllAsync(
    `SELECT * FROM queued_plants WHERE id IN (${placeholders(ids)}) ORDER BY created_at, rowid`,
    ids,
  )
  return withPhotos(db, queued)
}

// Every queued record for this user, oldest first, each with its photos (cover first) as
// `photos`: [{ position, local_path, storage_path, uploaded, row_saved }]
export async function getQueuedPlants(userId) {
  const db = await getDatabase()
  const rows = await db.getAllAsync(
    'SELECT * FROM queued_plants WHERE user_id = ? ORDER BY created_at, rowid',
    [userId],
  )
  return withPhotos(db, rows)
}

export async function getNextPendingPlant(userId) {
  const db = await getDatabase()
  const row = await db.getFirstAsync(
    `SELECT * FROM queued_plants WHERE user_id = ? AND status = 'pending'
     ORDER BY created_at, rowid LIMIT 1`,
    [userId],
  )
  if (!row) return null
  const [withItsPhotos] = await withPhotos(db, [row])
  return withItsPhotos
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

// The photo's file is in storage at its storage_path
export async function markPhotoUploaded(plantId, position) {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE queued_plant_photos SET uploaded = 1 WHERE plant_id = ? AND position = ?',
    [plantId, position],
  )
}

// The plant row is on the server; later attempts only add what is still missing
export async function markPlantSaved(id, qrCode) {
  const db = await getDatabase()
  await db.runAsync('UPDATE queued_plants SET plant_saved = 1, qr_code = ? WHERE id = ?', [
    qrCode,
    id,
  ])
}

// These photos' plant_photos rows are on the server
export async function markPhotoRowsSaved(plantId, positions) {
  if (positions.length === 0) return
  const db = await getDatabase()
  await db.runAsync(
    `UPDATE queued_plant_photos SET uploaded = 1, row_saved = 1
     WHERE plant_id = ? AND position IN (${placeholders(positions)})`,
    [plantId, ...positions],
  )
}

// The photo copies are deleted after the rows are updated, so a crash in between only leaves
// files that the next launch cleans up
export async function markSynced(id, qrCode) {
  const db = await getDatabase()
  const photos = await db.getAllAsync(
    'SELECT local_path FROM queued_plant_photos WHERE plant_id = ? AND local_path IS NOT NULL',
    [id],
  )
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE queued_plants
       SET status = 'synced', qr_code = COALESCE(?, qr_code), synced_at = ?, error_message = NULL
       WHERE id = ?`,
      [qrCode ?? null, new Date().toISOString(), id],
    )
    await txn.runAsync('UPDATE queued_plant_photos SET local_path = NULL WHERE plant_id = ?', [id])
  })
  for (const photo of photos) deletePhoto(photo.local_path)
}

// Puts a failed record back in line to sync. Whatever its last attempt saved stays saved.
export async function retryPlant(id) {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE queued_plants SET status = 'pending', error_message = NULL WHERE id = ? AND status = 'failed'",
    [id],
  )
}

// Only failed records can be discarded. Deletes the record and its photo copies from the phone,
// and resolves to { storagePaths }: files the record already uploaded that no plant_photos row
// uses, for the caller to remove from storage. Files whose row was saved stay: the plant on the
// server shows them.
export async function discardPlant(id) {
  const db = await getDatabase()
  const row = await db.getFirstAsync(
    "SELECT id FROM queued_plants WHERE id = ? AND status = 'failed'",
    [id],
  )
  if (!row) return { storagePaths: [] }

  const photos = await db.getAllAsync('SELECT * FROM queued_plant_photos WHERE plant_id = ?', [id])
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM queued_plant_photos WHERE plant_id = ?', [id])
    await txn.runAsync("DELETE FROM queued_plants WHERE id = ? AND status = 'failed'", [id])
  })
  for (const photo of photos) deletePhoto(photo.local_path)
  return {
    storagePaths: photos
      .filter((photo) => photo.uploaded && !photo.row_saved)
      .map((photo) => photo.storage_path),
  }
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

// A queued photo as a File, from the relative path stored in local_path
export function getQueuedPhoto(relativePath) {
  return new File(Paths.document, ...relativePath.split('/'))
}

// Adds each record's photos as `photos`, cover first
async function withPhotos(db, rows) {
  if (rows.length === 0) return rows
  const ids = rows.map((row) => row.id)
  const photos = await db.getAllAsync(
    `SELECT * FROM queued_plant_photos WHERE plant_id IN (${placeholders(ids)})
     ORDER BY plant_id, position`,
    ids,
  )
  const byPlant = new Map(ids.map((id) => [id, []]))
  for (const photo of photos) byPlant.get(photo.plant_id).push(photo)
  return rows.map((row) => ({ ...row, photos: byPlant.get(row.id) }))
}

async function deleteFinishedRecords(db) {
  const cutoff = new Date(Date.now() - SYNCED_RETENTION_MS).toISOString()
  await db.runAsync(
    `DELETE FROM queued_plants
     WHERE status = 'synced' AND (qr_shown_at IS NOT NULL OR synced_at < ?)`,
    [cutoff],
  )
  await db.runAsync(
    'DELETE FROM queued_plant_photos WHERE plant_id NOT IN (SELECT id FROM queued_plants)',
  )
}

// Copies left behind when the app closed between copying a photo and saving its row, or between
// syncing a record and deleting its copies
async function deleteOrphanPhotos(db) {
  try {
    const folder = new Directory(Paths.document, PHOTO_FOLDER)
    if (!folder.exists) return
    const rows = await db.getAllAsync(
      'SELECT local_path FROM queued_plant_photos WHERE local_path IS NOT NULL',
    )
    const inUse = new Set(rows.map((row) => row.local_path))
    for (const entry of folder.list()) {
      if (entry instanceof File && !inUse.has(`${PHOTO_FOLDER}/${entry.name}`)) entry.delete()
    }
  } catch {
    // Only tidying up; tried again on the next launch
  }
}

async function copyPhoto(photoId, sourceUri) {
  const folder = new Directory(Paths.document, PHOTO_FOLDER)
  folder.create({ intermediates: true, idempotent: true })
  const name = `${photoId}.jpg`
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
