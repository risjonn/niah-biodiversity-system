import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { MAX_SPECIES_PHOTOS, useSpecies } from '../hooks/useSpecies'
import { conservationStatusLabels, conservationStatuses } from '../lib/conservationStatus'

// A new species starts with no photos. Kept outside the component so the default is stable.
const NO_PHOTOS = []

// Adds a species at /species/new and edits one at /species/:id/edit
export default function SpeciesForm() {
  const { id } = useParams()
  // Keyed so moving between adding and editing, or between two species, starts a fresh form
  return id ? <EditSpecies key={id} id={id} /> : <SpeciesFields species={null} />
}

// Loads the species and its photos first, with the same loading, error and not-found states as
// SpeciesDetail. The photos must load too: saving compares against them.
function EditSpecies({ id }) {
  const { getSpeciesById, getSpeciesPhotos } = useSpecies()
  // Bumped by Retry so the species loads again
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSpeciesById(id), getSpeciesPhotos(id)]).then(([speciesResult, photosResult]) => {
      if (cancelled) return
      setResult({
        data: speciesResult.data,
        photos: photosResult.data,
        error: speciesResult.error ?? (speciesResult.data ? photosResult.error : null),
        attempt,
      })
    })
    return () => {
      cancelled = true
    }
  }, [getSpeciesById, getSpeciesPhotos, id, attempt])

  const isLoading = result?.attempt !== attempt

  if (isLoading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 4 }}>
        <CircularProgress aria-label="Loading species" />
      </Stack>
    )
  }

  if (result.error) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => setAttempt((current) => current + 1)}>
            Retry
          </Button>
        }
      >
        {result.error}
      </Alert>
    )
  }

  if (!result.data) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <PageHeader
          title="Species not found"
          subtitle="This species may have been removed, or the link may be wrong."
        />
        <Button component={RouterLink} to="/species">
          Back to species
        </Button>
      </Stack>
    )
  }

  return <SpeciesFields species={result.data} savedPhotos={result.photos} />
}

// The form itself. `species` is the record being edited, or null when adding one; `savedPhotos`
// its photos as loaded ([{ id, url, position }], cover first).
function SpeciesFields({ species, savedPhotos = NO_PHOTOS }) {
  const navigate = useNavigate()
  const toast = useToast()
  const {
    createSpecies,
    updateSpecies,
    saveSpeciesPhotos,
    speciesPhotoError,
    uploadSpeciesPhoto,
    removeSpeciesPhoto,
  } = useSpecies()
  const isEdit = Boolean(species)

  const [values, setValues] = useState(() => ({
    scientific_name: species?.scientific_name ?? '',
    common_name: species?.common_name ?? '',
    family: species?.family ?? '',
    conservation_status: species?.conservation_status ?? 'least_concern',
    description: species?.description ?? '',
    cultural_significance: species?.cultural_significance ?? '',
  }))
  // The photos as they will be saved, cover first: { key, id, url } for a saved one, and
  // { key, id: null, file, previewUrl } for a newly chosen one, not uploaded until the form is saved
  const [photos, setPhotos] = useState(() =>
    savedPhotos.map((photo) => ({ key: photo.id, id: photo.id, url: photo.url })),
  )
  const [nameError, setNameError] = useState(null)
  // Files that couldn't be added, as lines to show under the photos
  const [photoErrors, setPhotoErrors] = useState([])
  const [saveError, setSaveError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  // Every preview made on this page, so they can all be freed when it is left
  const previewUrlsRef = useRef(null)
  useEffect(() => {
    const previewUrls = new Set()
    previewUrlsRef.current = previewUrls
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url)
    }
  }, [])

  const cancelPath = isEdit ? `/species/${species.id}` : '/species'
  const isFull = photos.length >= MAX_SPECIES_PHOTOS

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function handleAddPhotos(event) {
    const files = [...(event.target.files ?? [])]
    // Cleared so choosing the same files again still counts as a change
    event.target.value = ''
    if (files.length === 0) return

    const errors = []
    const usable = []
    for (const file of files) {
      const invalid = speciesPhotoError(file)
      if (invalid) errors.push(`${file.name}: ${invalid}`)
      else usable.push(file)
    }
    const room = MAX_SPECIES_PHOTOS - photos.length
    const added = usable.slice(0, room)
    const leftOut = usable.length - added.length
    if (leftOut > 0) {
      errors.push(
        `${leftOut} ${leftOut === 1 ? 'photo was' : 'photos were'} not added: a species can have at most ${MAX_SPECIES_PHOTOS}.`,
      )
    }
    setPhotoErrors(errors)

    const newPhotos = added.map((file) => {
      const previewUrl = URL.createObjectURL(file)
      previewUrlsRef.current?.add(previewUrl)
      return { key: crypto.randomUUID(), id: null, file, previewUrl }
    })
    setPhotos((current) => [...current, ...newPhotos])
  }

  function handleRemovePhoto(key) {
    setPhotos((current) => current.filter((photo) => photo.key !== key))
    setPhotoErrors([])
  }

  // Moves a photo one place left (-1) or right (+1); the first photo is the cover. Focus stays on
  // the moved photo's move button (the other one once it reaches either end), since moving the
  // tile, or disabling the button, would otherwise drop keyboard focus.
  function handleMovePhoto(key, step) {
    setPhotos((current) => {
      const index = current.findIndex((photo) => photo.key === key)
      const target = index + step
      if (index === -1 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    requestAnimationFrame(() => {
      const tile = document.querySelector(`[data-photo-key="${key}"]`)
      const direction = step < 0 ? 'left' : 'right'
      const button =
        tile?.querySelector(`[data-move="${direction}"]:not(:disabled)`) ??
        tile?.querySelector('[data-move]:not(:disabled)')
      button?.focus()
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSaving) return

    const invalidName = values.scientific_name.trim() ? null : 'Enter a scientific name.'
    setNameError(invalidName)
    if (invalidName) return

    setIsSaving(true)
    setSaveError(null)

    // New photos are uploaded first, so nothing is saved unless every file made it. A failed
    // upload removes the ones that did; the chosen files stay in the form for the next try.
    const newPhotos = photos.filter((photo) => !photo.id)
    const uploads = await Promise.all(newPhotos.map((photo) => uploadSpeciesPhoto(photo.file)))
    const uploadedUrls = uploads.filter((upload) => !upload.error).map((upload) => upload.data)
    const failedUpload = uploads.find((upload) => upload.error)
    if (failedUpload) {
      for (const url of uploadedUrls) removeSpeciesPhoto(url)
      setSaveError(failedUpload.error)
      setIsSaving(false)
      return
    }

    const { data, error } = isEdit
      ? await updateSpecies(species.id, values)
      : await createSpecies(values)

    if (error) {
      for (const url of uploadedUrls) removeSpeciesPhoto(url)
      setSaveError(error)
      setIsSaving(false)
      return
    }

    // Then the photo rows, in the order on screen
    const uploadedUrlByKey = new Map(newPhotos.map((photo, index) => [photo.key, uploads[index].data]))
    const photoResult = await saveSpeciesPhotos(data.id, {
      original: savedPhotos,
      photos: photos.map((photo) =>
        photo.id ? { id: photo.id, url: photo.url } : { id: null, url: uploadedUrlByKey.get(photo.key) },
      ),
    })

    const verb = isEdit ? 'Saved' : 'Added'
    // The toasts are shown on the species page, which the app-wide toast outlives the navigation
    // to. The details are saved by now, so a photo failure goes there too, where the photos as
    // they were actually saved can be seen (and edited again).
    if (photoResult.error) {
      toast.error(`${verb} ${data.scientific_name}, but not all photo changes were saved. ${photoResult.error}`)
    } else {
      toast.success(`${verb} ${data.scientific_name}`)
    }
    navigate(`/species/${data.id}`)
  }

  return (
    <Stack spacing={3}>
      <PageHeader title={isEdit ? 'Edit species' : 'Add species'} />

      <Paper variant="outlined" component="form" noValidate onSubmit={handleSubmit} sx={{ p: 3 }}>
        <Stack spacing={3}>
          <TextField
            label="Scientific name"
            required
            value={values.scientific_name}
            onChange={(event) => {
              setField('scientific_name', event.target.value)
              setNameError(null)
            }}
            error={Boolean(nameError)}
            helperText={nameError}
            disabled={isSaving}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Common name"
              value={values.common_name}
              onChange={(event) => setField('common_name', event.target.value)}
              disabled={isSaving}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Family"
              value={values.family}
              onChange={(event) => setField('family', event.target.value)}
              disabled={isSaving}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            select
            label="Conservation status"
            required
            value={values.conservation_status}
            onChange={(event) => setField('conservation_status', event.target.value)}
            disabled={isSaving}
          >
            {conservationStatuses.map((status) => (
              <MenuItem key={status} value={status}>
                {conservationStatusLabels[status]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Description"
            multiline
            minRows={4}
            value={values.description}
            onChange={(event) => setField('description', event.target.value)}
            disabled={isSaving}
          />
          <TextField
            label="Cultural significance"
            multiline
            minRows={4}
            value={values.cultural_significance}
            onChange={(event) => setField('cultural_significance', event.target.value)}
            disabled={isSaving}
          />

          <Stack component="section" spacing={1.5} aria-labelledby="species-photos-heading">
            <Box>
              <Typography variant="h3" component="h2" id="species-photos-heading">
                Photos
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Up to {MAX_SPECIES_PHOTOS}, JPEG or PNG, 5 MB each. The first photo is the cover,
                shown on the species cards.
              </Typography>
            </Box>

            {photos.length > 0 ? (
              <Box
                component="ol"
                aria-label="Photos, cover first"
                sx={{
                  listStyle: 'none',
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gridTemplateColumns: (theme) => `repeat(auto-fill, minmax(${theme.spacing(20)}, 1fr))`,
                  gap: 2,
                }}
              >
                {photos.map((photo, index) => (
                  <PhotoTile
                    key={photo.key}
                    photoKey={photo.key}
                    url={photo.previewUrl ?? photo.url}
                    number={index + 1}
                    total={photos.length}
                    disabled={isSaving}
                    onMoveLeft={index > 0 ? () => handleMovePhoto(photo.key, -1) : null}
                    onMoveRight={
                      index < photos.length - 1 ? () => handleMovePhoto(photo.key, 1) : null
                    }
                    onRemove={() => handleRemovePhoto(photo.key)}
                  />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="textSecondary">
                No photos yet
              </Typography>
            )}

            <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
              <Button
                component="label"
                variant="outlined"
                startIcon={<AddPhotoAlternateOutlinedIcon />}
                disabled={isSaving || isFull}
              >
                Add photos
                <input
                  hidden
                  type="file"
                  multiple
                  accept="image/jpeg,image/png"
                  onChange={handleAddPhotos}
                  disabled={isSaving || isFull}
                />
              </Button>
              {isFull ? (
                <Typography variant="caption" color="textSecondary">
                  That&apos;s the most a species can have. Remove one to add another.
                </Typography>
              ) : null}
              {photoErrors.map((message) => (
                <Typography key={message} variant="caption" color="error">
                  {message}
                </Typography>
              ))}
            </Stack>
          </Stack>

          {saveError ? <Alert severity="error">{saveError}</Alert> : null}

          <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
            <Button component={RouterLink} to={cancelPath} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={isSaving}>
              {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add species'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  )
}

// One photo in the form: the image, "Cover" on the first, and move left / move right / remove.
// onMoveLeft and onMoveRight are null at either end.
function PhotoTile({ photoKey, url, number, total, disabled, onMoveLeft, onMoveRight, onRemove }) {
  const [status, setStatus] = useState('loading')
  const isCover = number === 1

  return (
    <Box component="li" data-photo-key={photoKey} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          position: 'relative',
          aspectRatio: '4 / 3',
          overflow: 'hidden',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
      >
        {status === 'loading' ? (
          <Skeleton
            variant="rectangular"
            aria-label="Loading photo"
            sx={{ position: 'absolute', inset: 0, height: '100%' }}
          />
        ) : null}
        {status === 'error' ? <PhotoMessage>This photo could not be loaded.</PhotoMessage> : null}
        <Box
          component="img"
          src={url}
          alt={isCover ? `Photo ${number} of ${total}, the cover` : `Photo ${number} of ${total}`}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          sx={{
            display: status === 'loaded' ? 'block' : 'none',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {isCover ? (
          <Chip
            label="Cover"
            size="small"
            color="primary"
            sx={{ position: 'absolute', top: 8, left: 8 }}
          />
        ) : null}
      </Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
        <Stack direction="row">
          <IconButton
            aria-label={`Move photo ${number} left`}
            data-move="left"
            onClick={onMoveLeft ?? undefined}
            disabled={disabled || !onMoveLeft}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            aria-label={`Move photo ${number} right`}
            data-move="right"
            onClick={onMoveRight ?? undefined}
            disabled={disabled || !onMoveRight}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <IconButton aria-label={`Remove photo ${number}`} color="error" onClick={onRemove} disabled={disabled}>
          <DeleteOutlineIcon />
        </IconButton>
      </Stack>
    </Box>
  )
}

function PhotoMessage({ children }) {
  return (
    <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center' }}>
        {children}
      </Typography>
    </Stack>
  )
}
