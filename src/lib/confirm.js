import { Alert, Platform } from 'react-native';

// Alert.alert with buttons does nothing on web, so fall back to the browser dialogs.
export function confirmAction(title, message, confirmText = 'OK') {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function notify(message) {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert(message);
}
