import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import HeaderIconButton from '../components/HeaderIconButton'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'
import LoginScreen from '../screens/LoginScreen'
import FieldRegistrationScreen from '../screens/FieldRegistrationScreen'
import MyRecordsScreen from '../screens/MyRecordsScreen'
import StaffHomeScreen from '../screens/StaffHomeScreen'
import GuestScanScreen from '../screens/GuestScanScreen'
import SettingsScreen from '../screens/SettingsScreen'

const Stack = createNativeStackNavigator()

const screenOptions = {
  headerStyle: { backgroundColor: theme.colors.primary },
  headerTintColor: theme.colors.surfaceWhite,
  headerTitleStyle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
  },
  // Back button shows only the chevron, never the previous screen's title (iOS; Android
  // never shows one)
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: theme.colors.surface },
}

const signedInScreens = {
  FieldRegistration: { component: FieldRegistrationScreen, options: { title: 'Register Plant' } },
  MyRecords: { component: MyRecordsScreen, options: { title: 'My Records' } },
  StaffHome: { component: StaffHomeScreen, options: { title: 'Staff Dashboard' } },
  Settings: { component: SettingsScreen },
}

// Screens each role can open once signed in. Each role lands on the first screen in its list
// (order is used instead of initialRouteName, which the navigator only reads when first created).
// Conservation officers' and admins' own screens come in later issues, so for now they land on
// a placeholder dashboard.
const screensByRole = {
  botanist: ['FieldRegistration', 'MyRecords', 'Settings'],
  conservation_officer: ['StaffHome', 'Settings'],
  admin: ['StaffHome', 'Settings'],
}

export default function RootNavigator() {
  const { isLoading, role } = useAuth()

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Loading" />
      </View>
    )
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={screenOptions}>
        {role ? (
          <Stack.Group screenOptions={signedInScreenOptions}>
            {screensByRole[role].map((name) => (
              <Stack.Screen key={name} name={name} {...signedInScreens[name]} />
            ))}
          </Stack.Group>
        ) : (
          // Signed out: only the login screen and guest mode are reachable
          <Stack.Group screenOptions={{ animationTypeForReplace: 'pop' }}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Niah Biodiversity' }} />
            <Stack.Screen name="GuestScan" component={GuestScanScreen} options={{ title: 'Explore' }} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

// Every signed-in screen links to Settings, which is where users sign out
function signedInScreenOptions({ navigation, route }) {
  if (route.name === 'Settings') return {}
  return {
    headerRight: () => (
      <HeaderIconButton
        name="settings-outline"
        accessibilityLabel="Settings"
        onPress={() => navigation.navigate('Settings')}
      />
    ),
  }
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
})
