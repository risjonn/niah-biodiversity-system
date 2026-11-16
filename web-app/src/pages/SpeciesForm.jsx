import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useSpecies } from '../hooks/useSpecies'
import { conservationStatusLabels, conservationStatuses } from '../lib/conservationStatus'

// Adds a species at /species/new and edits one at /species/:id/edit
export default function SpeciesForm() {
  const { id } = useParams()
  // Keyed so moving between adding and editing, or between two species, starts a fresh form
  return id ? <EditSpecies key={id} id={id} /> : <SpeciesFields species={null} />
}

// Loads the species first, with the same loading, error and not-found states as SpeciesDetail
function EditSpecies({ id }) {
  const { getSpeciesById } = useSpecies()
  // Bumped by Retry so the species loads again
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSpeciesById(id).then((nextResult) => {
      if (!cancelled) setResult({ ...nextResult, attempt })
    })
    return () => {
      cancelled = true
    }
  }, [getSpeciesById, id, attempt])

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

  return <SpeciesFields species={result.data} />
}

// The form itself. `species` is the record being edited, or null when adding one.
function SpeciesFields({ species }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { createSpecies, updateSpecies, speciesPhotoError, uploadSpeciesPhoto, removeSpeciesPhoto } =
    useSpecies()
  const isEdit = Boolean(species)
  const currentPhotoUrl = species?.reference_photo_url ?? null

  const [values, setValues] = useState(() => ({
    scientific_name: species?.scientific_name ?? '',
    common_name: species?.common_name ?? '',
    family: species?.family ?? '',
    conservation_status: species?.conservation_status ?? 'least_concern',
    description: species?.description ?? '',
    cultural_significance: species?.cultural_significance ?? '',
  }))
  // A newly chosen photo, { file, previewUrl }, not uploaded until the form is saved
  const [newPhoto, setNewPhoto] = useState(null)
  // Set by "Remove photo", so the record is saved without the photo it had
  const [isCurrentPhotoRemoved, setIsCurrentPhotoRemoved] = useState(false)
  const [nameError, setNameError] = useState(null)
  const [photoError, setPhotoError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  // Frees each preview once it is replaced, removed or the page is left
  useEffect(() => {
    return () => {
      if (newPhoto) URL.revokeObjectURL(newPhoto.previewUrl)
    }
  }, [newPhoto])

  const shownPhotoUrl = newPhoto?.previewUrl ?? (isCurrentPhotoRemoved ? null : currentPhotoUrl)
  const cancelPath = isEdit ? `/species/${species.id}` : '/species'

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function handleChoosePhoto(event) {
    const file = event.target.files?.[0]
    // Cleared so choosing the same file again still counts as a change
    event.target.value = ''
    if (!file) return

    const invalid = speciesPhotoError(file)
    setPhotoError(invalid)
    if (invalid) return
    setNewPhoto({ file, previewUrl: URL.createObjectURL(file) })
  }

  function handleRemovePhoto() {
    setNewPhoto(null)
    setIsCurrentPhotoRemoved(true)
    setPhotoError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSaving) return

    const invalidName = values.scientific_name.trim() ? null : 'Enter a scientific name.'
    setNameError(invalidName)
    if (invalidName) return
    const invalidPhoto = newPhoto ? speciesPhotoError(newPhoto.file) : null
    setPhotoError(invalidPhoto)
    if (invalidPhoto) return

    setIsSaving(true)
    setSaveError(null)

    // A new photo is uploaded first, so the record is only ever saved with a photo that exists
    let photoUrl = isCurrentPhotoRemoved ? null : currentPhotoUrl
    let uploadedUrl = null
    if (newPhoto) {
      const upload = await uploadSpeciesPhoto(newPhoto.file)
      if (upload.error) {
        setSaveError(upload.error)
        setIsSaving(false)
        return
      }
      uploadedUrl = upload.data
      photoUrl = uploadedUrl
    }

    const fields = { ...values, reference_photo_url: photoUrl }
    const { data, error } = isEdit
      ? await updateSpecies(species.id, fields)
      : await createSpecies(fields)

    if (error) {
      // Nothing points at the photo just uploaded, so it goes; the chosen file stays in the form
      // and is uploaded again on the next try
      if (uploadedUrl) removeSpeciesPhoto(uploadedUrl)
      setSaveError(error)
      setIsSaving(false)
      return
    }

    // The old photo was replaced or removed and nothing points at it any more. Not awaited:
    // removeSpeciesPhoto never fails and leaving the page doesn't stop it.
    if (currentPhotoUrl && currentPhotoUrl !== photoUrl) removeSpeciesPhoto(currentPhotoUrl)
    // Shown on the species page, which the app-wide toast outlives the navigation to
    toast.success(`${isEdit ? 'Saved' : 'Added'} ${data.scientific_name}`)
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

          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="h3" component="h2">
              Reference photo
            </Typography>
            {/* Keyed by the URL so a newly chosen photo starts loading again */}
            <PhotoPreview key={shownPhotoUrl ?? ''} url={shownPhotoUrl} />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button component="label" variant="outlined" disabled={isSaving}>
                Choose photo
                <input
                  hidden
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleChoosePhoto}
                  disabled={isSaving}
                />
              </Button>
              {shownPhotoUrl ? (
                <Button color="error" onClick={handleRemovePhoto} disabled={isSaving}>
                  Remove photo
                </Button>
              ) : null}
            </Stack>
            <Typography variant="caption" color={photoError ? 'error' : 'text.secondary'}>
              {photoError ?? 'JPEG or PNG, up to 5 MB.'}
            </Typography>
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

// The photo the species will be saved with, or a neutral placeholder when there is none
function PhotoPreview({ url }) {
  const [status, setStatus] = useState('loading')

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: (theme) => theme.spacing(40),
        aspectRatio: '4 / 3',
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      {url ? (
        <>
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
            alt="Reference photo"
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            sx={{
              display: status === 'loaded' ? 'block' : 'none',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </>
      ) : (
        <PhotoMessage>No reference photo</PhotoMessage>
      )}
    </Box>
  )
}

function PhotoMessage({ children }) {
  return (
    <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        {children}
      </Typography>
    </Stack>
  )
}
