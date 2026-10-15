import { StyleSheet, Text, View } from 'react-native'
import Button from '../components/Button'
import { theme } from '../theme/theme'

export default function BotanistHomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome, Botanist!</Text>
        <Text style={styles.subtitle}>
          Manage plant records and field documentation.
        </Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Register a Plant</Text>
          <Text style={styles.cardDescription}>
            Record a new plant with species information, photos, and GPS location.
          </Text>

          <Button
            title="Register Plant"
            onPress={() => navigation.navigate('FieldRegistration')}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>My Records</Text>
          <Text style={styles.cardDescription}>
            View your submitted plants and check their review status.
          </Text>

          <Button
            title="View My Records"
            onPress={() => navigation.navigate('MyRecords')}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Plant Species Database</Text>
          <Text style={styles.cardDescription}>
            Search plant species by scientific or common name.
          </Text>
          <Button
            title="Search Plant Species"
            onPress={() => navigation.navigate('PlantSpecies')}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },

  header: {
    marginBottom: theme.spacing.xxl,
  },

  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    fontWeight: theme.typography.heading1.fontWeight,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
  },

  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.body.fontWeight,
    lineHeight: 24,
    color: theme.colors.textSecondary,
  },

  actions: {
    gap: theme.spacing.lg,
  },

  card: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },

  cardTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
  },

  cardDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
})