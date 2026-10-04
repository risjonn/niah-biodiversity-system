import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Button from './Button'
import TextInput from './TextInput'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'

// A form field for choosing a species. Looks like TextInput (label, box, error beneath) and opens
// a searchable list in a modal. Loads the species list itself when first shown.
export default function SpeciesPicker({ label, value, onChange, error, style }) {
  const { fetchSpecies } = useSpecies()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState(null)

  const loadSpecies = useCallback(() => {
    setResult(null)
    return fetchSpecies().then(setResult)
  }, [fetchSpecies])

  useEffect(() => {
    let cancelled = false
    fetchSpecies().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSpecies])

  function close() {
    setOpen(false)
    setSearch('')
  }

  function choose(species) {
    onChange(species)
    close()
  }

  const term = search.trim().toLowerCase()
  const matches = (result?.data ?? []).filter(
    (species) =>
      !term ||
      species.scientific_name.toLowerCase().includes(term) ||
      species.common_name?.toLowerCase().includes(term),
  )

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value?.scientific_name ?? 'None chosen' }}
        style={[styles.field, error && styles.fieldError]}
      >
        {value ? (
          <SpeciesName species={value} />
        ) : (
          <Text style={styles.placeholder}>Choose a species</Text>
        )}
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={close}
      >
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose a species</Text>
            <TextInput
              placeholder="Search by scientific or common name"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>

          {!result ? (
            <ActivityIndicator
              style={styles.status}
              color={theme.colors.primary}
              accessibilityLabel="Loading species"
            />
          ) : null}
          {result?.error ? (
            <View style={styles.status}>
              <Text style={styles.statusError}>{result.error}</Text>
              <Button title="Try again" variant="secondary" onPress={loadSpecies} />
            </View>
          ) : null}
          {result && !result.error ? (
            <FlatList
              data={matches}
              keyExtractor={(species) => species.id}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<Text style={styles.statusText}>No species found</Text>}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => choose(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === value?.id }}
                  style={({ pressed }) => [
                    styles.option,
                    item.id === value?.id && styles.optionSelected,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <SpeciesName species={item} />
                </Pressable>
              )}
            />
          ) : null}

          <View style={styles.modalFooter}>
            <Button title="Cancel" variant="secondary" onPress={close} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

function SpeciesName({ species }) {
  return (
    <View>
      <Text style={styles.scientificName}>{species.scientific_name}</Text>
      {species.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // label, field and error match TextInput so the picker sits in a form like any other field
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  field: {
    minHeight: theme.buttonHeight,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  fieldError: {
    borderColor: theme.colors.error,
  },
  placeholder: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
  scientificName: {
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  modal: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  modalHeader: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  modalTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  modalFooter: {
    padding: theme.spacing.lg,
  },
  status: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  statusText: {
    padding: theme.spacing.lg,
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textSecondary,
  },
  statusError: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
  option: {
    minHeight: theme.buttonHeight,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surfaceWhite,
  },
  optionSelected: {
    borderLeftWidth: theme.spacing.xs,
    borderLeftColor: theme.colors.primary,
  },
  optionPressed: {
    opacity: 0.8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
})
