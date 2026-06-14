import { File } from 'expo-file-system';
import { Platform } from 'react-native';

export async function appendImageFile(
  formData: FormData,
  field: string,
  uri: string,
  fileName: string,
) {
  if (Platform.OS === 'web') {
    const imageResponse = await fetch(uri);
    formData.append(field, await imageResponse.blob(), fileName);
    return;
  }

  // Expo SDK 56 fetch only accepts Blob-like values with bytes(). The legacy
  // React Native { uri, name, type } FormData part throws on Android.
  const file = new File(uri);
  if (!file.exists) throw new Error('The selected photo is no longer available.');
  formData.append(field, file, fileName);
}
