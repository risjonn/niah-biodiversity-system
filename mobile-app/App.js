import {
  useFonts,
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AuthProvider } from './src/context/AuthContext'
import { SyncProvider } from './src/context/SyncContext'
import RootNavigator from './src/navigation/RootNavigator'

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    // Scientific names (ScientificName component). iOS doesn't slant a font that has no italic.
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    // Font for header icons; loading it here stops icons popping in after the header renders
    ...Ionicons.font,
  })

  if (!fontsLoaded) {
    return null
  }

  return (
    <AuthProvider>
      <SyncProvider>
        <RootNavigator />
      </SyncProvider>
    </AuthProvider>
  )
}