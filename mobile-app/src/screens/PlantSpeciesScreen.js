import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import ScientificName from '../components/ScientificName'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'

export default function PlantSpeciesScreen() {
  const { fetchSpecies } = useSpecies()

  const [species, setSpecies] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadSpecies = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await fetchSpecies()

      if (result.error) {
        setError(result.error)
      } else {
        setSpecies(result.data ?? [])
      }
    } catch {
      setError('Unable to load plant species. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [fetchSpecies])

  useFocusEffect(
    useCallback(() => {
      loadSpecies()
    }, [loadSpecies])
  )

  const filteredSpecies = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    if (!keyword) return species

    return species.filter((item) =>
      [item.scientific_name, item.common_name].some((name) =>
        name?.toLowerCase().includes(keyword)
      )
    )
  }, [species, search])

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Plant Species</Text>
        <Text style={styles.subtitle}>
          Search the species database by scientific or common name.
        </Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search plant species..."
        placeholderTextColor={theme.colors.textSecondary}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search plant species"
        returnKeyType="search"
      />

      <View style={styles.resultHeader}>
        <Text style={styles.resultCount}>
          {loading ? 'Loading species...' : `${filteredSpecies.length} species found`}
        </Text>

        <Pressable
          style={styles.refreshButton}
          onPress={loadSpecies}
          disabled={loading}
        >
          <Text style={styles.refreshText}>
            {loading ? 'Loading...' : 'Refresh'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            accessibilityLabel="Loading plant species"
          />
        </View>
      ) : error ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Unable to load species</Text>
          <Text style={styles.message}>{error}</Text>

          <Pressable style={styles.retryButton} onPress={loadSpecies}>
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      ) : filteredSpecies.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No species found</Text>
          <Text style={styles.message}>
            Try another scientific or common name.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredSpecies.map((item) => (
            <View key={item.id} style={styles.card}>
              <ScientificName style={styles.scientificName}>
                {item.scientific_name}
              </ScientificName>

              <Text style={styles.commonName}>
                {item.common_name || 'Common name not available'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  header: {
    gap: theme.spacing.xs,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
  searchInput: {
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  resultCount: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  refreshButton: {
    minHeight: theme.buttonHeight,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  refreshText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary,
  },
  list: {
    gap: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  scientificName: {
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  center: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  emptyTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: theme.buttonHeight,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius,
    backgroundColor: theme.colors.primary,
  },
  retryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.surfaceWhite,
  },
})
