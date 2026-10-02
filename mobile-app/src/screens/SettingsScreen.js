import { View, Text, StyleSheet } from 'react-native'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'

export default function SettingsScreen() {
  const { signOut } = useAuth()

  return (
    <View style={styles.container}>
      <Text>Settings — coming soon</Text>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg, gap: theme.spacing.lg },
})
