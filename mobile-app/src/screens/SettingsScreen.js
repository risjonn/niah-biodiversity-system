import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'

export default function SettingsScreen() {
  const { user, role, signOut } = useAuth()

  function handleSignOut() {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: signOut,
        },
      ],
    )
  }

  function showAbout() {
    Alert.alert(
      'About This App',
      'Smart Ground-Truthing and Digital Biodiversity System\n\n' +
        'A digital platform for plant species documentation and biodiversity management at Niah National Park.\n\n' +
        'COS30049 Group Project\n' +
        'Version 1.0.0',
      [{ text: 'Close' }],
    )
  }

  function showHelp() {
    Alert.alert(
      'Help & Support',
      'If you experience any problems with the application, please contact your system administrator or project team for assistance.',
      [{ text: 'Close' }],
    )
  }

  function showDataPrivacy() { 
    Alert.alert( 
      'Data & Privacy', 
      'Location Data\n' + 
       'Your location is used when recording plant locations.\n\n' + 
       'Photos\n' + 
       'Photos may be attached to plant records for documentation.\n\n' + 
       'Account Data\n' + 
       'Your account information is protected by role-based access control.', 
      [{ text: 'Close' }], 
    ) 
  }

  return (
    <View style={styles.container}>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.card}>
          <View style={styles.item}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>
              {user?.email ?? 'Not available'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.item}>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{formatRole(role)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>

        <View style={styles.card}>
          <View style={styles.item}>
            <Text style={styles.label}>App Version</Text>
            <Text style={styles.value}>1.0.0</Text>
          </View>

          <View style={styles.divider} />

          <Pressable style={styles.actionRow} onPress={showAbout}>
            <View style={styles.actionContent}>
              <Text style={styles.value}>About This App</Text>
              <Text style={styles.description}>
                Learn more about the biodiversity system.
              </Text>
            </View>

            <Text style={styles.arrow}>›</Text>
          </Pressable>

          <View style={styles.divider} />

          <Pressable style={styles.actionRow} onPress={showHelp}>
            <View style={styles.actionContent}>
              <Text style={styles.value}>Help & Support</Text>
              <Text style={styles.description}>
                Get help with using the application.
              </Text>
            </View>

            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>

        <View style={styles.securityCard}>
          <View style={styles.securityContent}>
            <Text style={styles.value}>Account Protection</Text>
            <Text style={styles.description}>
              Your account is protected by role-based access control.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}> 
        <Text style={styles.sectionTitle}>Data & Privacy</Text> 
        
        <View style={styles.card}> 
          <Pressable style={styles.actionRow} onPress={showDataPrivacy}> 
            <View style={styles.actionContent}> 
              <Text style={styles.value}>Data & Privacy</Text> 
              <Text style={styles.description}> Learn how location, photos, and account data are used. </Text>
            </View> 
              
            <Text style={styles.arrow}>›</Text> 
          </Pressable> 
        </View> 
      </View>

      <View style={styles.signOutContainer}>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={handleSignOut}
        />
      </View>
    </View>
  )
}

function formatRole(role) {
  if (!role) return 'Not available'

  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },

  section: {
    gap: theme.spacing.sm,
  },

  sectionTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    fontWeight: theme.typography.heading3.fontWeight,
    color: theme.colors.textPrimary,
  },

  card: {
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },

  item: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },

  label: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    color: theme.colors.textSecondary,
  },

  value: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.body.fontWeight,
    color: theme.colors.textPrimary,
  },

  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.bodySmall.fontWeight,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },

  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },

  actionRow: {
    minHeight: theme.buttonHeight,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },

  actionContent: {
    flex: 1,
    gap: theme.spacing.xs,
  },

  arrow: {
    fontFamily: 'Inter_400Regular',
    marginLeft: theme.spacing.md,
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textSecondary,
  },

  securityCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    overflow: 'hidden',
  },

  securityContent: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },

  signOutContainer: {
    marginTop: 'auto',
    paddingTop: theme.spacing.lg,
  },
})