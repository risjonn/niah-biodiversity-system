import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import Ionicons from '@expo/vector-icons/Ionicons'
import { StatusBar } from 'expo-status-bar'
import { useAppLock } from '../context/AppLockContext'
import { useAuth } from '../context/AuthContext'
import { isStaffRole } from '../lib/roles'
import { theme } from '../theme/theme'
import LockScreen from '../screens/LockScreen'
import LoginScreen from '../screens/LoginScreen'
import BotanistHomeScreen from '../screens/BotanistHomeScreen'
import FieldRegistrationScreen from '../screens/FieldRegistrationScreen'
import MyRecordsScreen from '../screens/MyRecordsScreen'
import GuestScanScreen from '../screens/GuestScanScreen'
import SettingsScreen from '../screens/SettingsScreen'
import PlantSpeciesScreen from '../screens/PlantSpeciesScreen'
import RecordDetailScreen from '../screens/RecordDetailScreen'
import SpeciesDetailScreen from '../screens/SpeciesDetailScreen'
import AlertsScreen from '../screens/AlertsScreen'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

// The primary-coloured header, shared by the stack and the tabs
const headerOptions = {
  headerStyle: { backgroundColor: theme.colors.primary },
  headerTintColor: theme.colors.surfaceWhite,
  headerTitleStyle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading3.fontSize,
  },
}

const screenOptions = {
  ...headerOptions,
  // Back button shows only the chevron, never the previous screen's title (iOS; Android
  // never shows one)
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: theme.colors.surface },
}

// The field app's tabs, left to right, for every role. The route names are the ones the screens
// already navigate to (e.g. navigation.navigate('FieldRegistration')), so those calls switch tab.
// `icon` is the Ionicons name when selected; the outline version is used otherwise.
const FIELD_TABS = [
  { name: 'BotanistHome', component: BotanistHomeScreen, label: 'Home', icon: 'home', title: 'Home' },
  { name: 'FieldRegistration', component: FieldRegistrationScreen, label: 'Register', icon: 'add-circle', title: 'Register Plant' },
  { name: 'MyRecords', component: MyRecordsScreen, label: 'Records', icon: 'list', title: 'My Records' },
  { name: 'PlantSpecies', component: PlantSpeciesScreen, label: 'Species', icon: 'leaf', title: 'Plant Species' },
  { name: 'Alerts', component: AlertsScreen, label: 'Alerts', icon: 'notifications', title: 'Alerts', staffOnly: true },
  { name: 'Settings', component: SettingsScreen, label: 'Settings', icon: 'settings', title: 'Settings' },
]

// Signed-in users: a bottom tab bar with the field screens. Conservation officers and admins get
// the same tabs as botanists plus Alerts; reviewing, sensors, users and reports stay on the web.
// The tab bar keeps clear of the iPhone home indicator by itself (it pads by the safe area inset).
function FieldTabs() {
  const { role } = useAuth()
  const staff = isStaffRole(role)
  const tabs = FIELD_TABS.filter((tab) => staff || !tab.staffOnly)

  return (
    <Tab.Navigator
      screenOptions={{
        ...headerOptions,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceWhite,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: theme.typography.caption.fontSize,
        },
        // On Android the bar would otherwise ride up on top of the keyboard on the forms
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      {tabs.map((tab) => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{
            title: tab.title,
            tabBarLabel: tab.label,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? tab.icon : `${tab.icon}-outline`} size={size} color={color} />
            ),
            // Home draws its own greeting band in place of the header
            ...(tab.name === 'BotanistHome' && { headerShown: false }),
            // Alerts mounts with the tabs, so its badge (the open count, which the screen sets)
            // shows before the tab is first opened
            ...(tab.name === 'Alerts' && {
              lazy: false,
              tabBarBadgeStyle: {
                backgroundColor: theme.colors.error,
                color: theme.colors.surfaceWhite,
                fontFamily: 'Inter_500Medium',
                fontSize: theme.typography.caption.fontSize,
              },
            }),
          }}
        />
      ))}
    </Tab.Navigator>
  )
}

// Every role gets the tabs, with the detail screens stacked above them (with a back button).
// Each detail screen sets its title once its record or species loads.
const signedInScreens = [
  { name: 'FieldTabs', component: FieldTabs, options: { headerShown: false } },
  { name: 'RecordDetail', component: RecordDetailScreen, options: { title: 'Plant record' } },
  { name: 'SpeciesDetail', component: SpeciesDetailScreen, options: { title: 'Species' } },
]

export default function RootNavigator() {
  const { isLoading, role, user } = useAuth()
  const { status: lockStatus, covered } = useAppLock()
  // Where the user was when the app last locked, so unlocking takes them back there. The lock
  // screen replaces the navigator, rather than covering it, because an open modal (such as a
  // full-screen photo) would show above anything drawn over it. Only reused for the same user and
  // role.
  const [savedNavigation, setSavedNavigation] = useState(null)
  const navigationKey = `${user?.id}:${role}`

  if (isLoading || lockStatus === 'checking') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Loading" />
      </View>
    )
  }

  if (lockStatus === 'locked') {
    return <LockScreen />
  }

  return (
    <NavigationContainer
      initialState={savedNavigation?.key === navigationKey ? savedNavigation.state : undefined}
      onStateChange={(state) => setSavedNavigation({ key: navigationKey, state })}
    >
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={screenOptions}>
        {role ? (
          <Stack.Group>
            {signedInScreens.map((screen) => (
              <Stack.Screen key={screen.name} {...screen} />
            ))}
          </Stack.Group>
        ) : (
          // Signed out: only the login screen and guest mode (scanning tags and browsing species,
          // read-only) are reachable
          <Stack.Group screenOptions={{ animationTypeForReplace: 'pop' }}>
            {/* Login draws its own title band in place of the header */}
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            {/* The band under the header carries the title, so the header shows only Back */}
            <Stack.Screen
              name="GuestScan"
              component={GuestScanScreen}
              options={{ title: '', headerShadowVisible: false }}
            />
            <Stack.Screen
              name="PlantSpecies"
              component={PlantSpeciesScreen}
              options={{ title: 'Plant Species' }}
              initialParams={{ guest: true }}
            />
            <Stack.Screen
              name="SpeciesDetail"
              component={SpeciesDetailScreen}
              options={{ title: 'Species' }}
              initialParams={{ guest: true }}
            />
          </Stack.Group>
        )}
      </Stack.Navigator>
      {/* A blank screen while the app is in the background with the lock on (AppLockContext) */}
      {covered ? <View style={[StyleSheet.absoluteFill, styles.cover]} /> : null}
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: theme.colors.surface,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
})
