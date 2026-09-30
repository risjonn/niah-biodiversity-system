import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import LoginScreen from '../screens/LoginScreen'
import FieldRegistrationScreen from '../screens/FieldRegistrationScreen'
import MyRecordsScreen from '../screens/MyRecordsScreen'
import GuestScanScreen from '../screens/GuestScanScreen'
import SettingsScreen from '../screens/SettingsScreen'

const Stack = createNativeStackNavigator()

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="GuestScan">
        <Stack.Screen name="GuestScan" component={GuestScanScreen} options={{ title: 'Explore' }} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="FieldRegistration" component={FieldRegistrationScreen} options={{ title: 'Register Plant' }} />
        <Stack.Screen name="MyRecords" component={MyRecordsScreen} options={{ title: 'My Records' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}