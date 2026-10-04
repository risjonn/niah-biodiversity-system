import { Text } from 'react-native'
import { theme } from '../theme/theme'

// A species' scientific name, in italic Inter. Sets only the font, so size and colour come from
// `style`, or from the surrounding Text when used inline inside a sentence.
export default function ScientificName({ style, children }) {
  return <Text style={[{ fontFamily: theme.fontFamily.italic }, style]}>{children}</Text>
}
