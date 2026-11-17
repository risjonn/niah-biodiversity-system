import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import Ionicons from '@expo/vector-icons/Ionicons'
import { StatusBar } from 'expo-status-bar'
import HeaderIconButton from '../components/HeaderIconButton'
import { useAuth } from '../context/AuthContext'
import { theme } from '../theme/theme'
import LoginScreen from '../screens/LoginScreen'
import BotanistHomeScreen from '../screens/BotanistHomeScreen'
import FieldRegistrationScreen from '../screens/FieldRegistrationScreen'
import MyRecordsScreen from '../screens/MyRecordsScreen'
import StaffHomeScreen from '../screens/StaffHomeScreen'
import GuestScanScreen from '../screens/GuestScanScreen'
import SettingsScreen from '../screens/SettingsScreen'
import PlantSpeciesScreen from '../screens/PlantSpeciesScreen'
import RecordDetailScreen from '../screens/RecordDetailScreen'
import SpeciesDetailScreen from '../screens/SpeciesDetailScreen'

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

// Botanists' tabs, left to right. The route names are the ones the screens already navigate to
// (e.g. navigation.navigate('FieldRegistration')), so those calls switch tab. `icon` is the
// Ionicons name when selected; the outline version is used otherwise.
const BOTANIST_TABS = [
  { name: 'BotanistHome', component: BotanistHomeScreen, label: 'Home', icon: 'home', title: 'Home' },
  { name: 'FieldRegistration', component: FieldRegistrationScreen, label: 'Register', icon: 'add-circle', title: 'Register Plant' },
  { name: 'MyRecords', component: MyRecordsScreen, label: 'Records', icon: 'list', title: 'My Records' },
  { name: 'PlantSpecies', component: PlantSpeciesScreen, label: 'Species', icon: 'leaf', title: 'Plant Species' },
  { name: 'Settings', component: SettingsScreen, label: 'Settings', icon: 'settings', title: 'Settings' },
]

// Signed-in botanists: a bottom tab bar with every botanist screen. The tab bar keeps clear of
// the iPhone home indicator by itself (it pads by the safe area inset).
function BotanistTabs() {
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
      {BOTANIST_TABS.map((tab) => (
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
          }}
        />
      ))}
    </Tab.Navigator>
  )
}

const signedInScreens = {
  BotanistTabs: { component: BotanistTabs, options: { headerShown: false } },
  // Above the tabs, with a back button. Each sets its title once its record or species loads.
  RecordDetail: { component: RecordDetailScreen, options: { title: 'Plant record' } },
  SpeciesDetail: { component: SpeciesDetailScreen, options: { title: 'Species' } },
  StaffHome: { component: StaffHomeScreen, options: { title: 'Staff Dashboard' } },
  Settings: { component: SettingsScreen },
}

// Screens each role can open once signed in. Each role lands on the first screen in its list
// (order is used instead of initialRouteName, which the navigator only reads when first created).
// Botanists get every screen through their tabs, with the detail screens stacked above them. Conservation officers' and admins' own screens
// come in later issues, so for now they land on a placeholder dashboard.
const screensByRole = {
  botanist: ['BotanistTabs', 'RecordDetail', 'SpeciesDetail'],
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
          <Stack.Group screenOptions={staffScreenOptions}>
            {screensByRole[role].map((name) => (
              <Stack.Screen key={name} name={name} {...signedInScreens[name]} />
            ))}
          </Stack.Group>
        ) : (
          // Signed out: only the login screen and guest mode are reachable
          <Stack.Group screenOptions={{ animationTypeForReplace: 'pop' }}>
            {/* Login draws its own title band in place of the header */}
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="GuestScan" component={GuestScanScreen} options={{ title: 'Explore' }} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

// Staff have no tab bar, so their dashboard keeps a settings button in the header, which is where
// they sign out. Botanists reach Settings from the tab bar instead.
function staffScreenOptions({ navigation, route }) {
  if (route.name !== 'StaffHome') return {}
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
