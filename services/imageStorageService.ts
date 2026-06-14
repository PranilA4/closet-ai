import { ClosetUser, ClothingItem, NewClothingItem } from '../types';
import { apiUrl } from './aiClothingService';
import { getAuthToken } from './authService';
import { appendImageFile } from './formDataImage';

const authHeaders = async (user: ClosetUser) => {
  const token = await getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-closet-user': user.uid,
  };
};

export async function persistClothingImage(
  user: ClosetUser,
  id: string,
  item: NewClothingItem,
): Promise<Pick<ClothingItem, 'imageUri' | 'imageSource' | 'objectKey'>> {
  if (!apiUrl || item.imageSource === 'sample') {
    return { imageUri: item.imageUri, imageSource: item.imageSource };
  }

  if (item.imageSource === 'retailer' && item.imageUri.startsWith('http')) {
    return { imageUri: item.imageUri, imageSource: 'retailer' };
  }

  try {
    if (item.imageUri.startsWith('http')) {
      const response = await fetch(`${apiUrl}/api/storage/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(user)) },
        body: JSON.stringify({ imageUrl: item.imageUri, itemId: id }),
      });
      if (!response.ok) throw new Error('Remote image import failed.');
      return (await response.json()) as Pick<
        ClothingItem,
        'imageUri' | 'imageSource' | 'objectKey'
      >;
    }

    const formData = new FormData();
    formData.append('itemId', id);
    await appendImageFile(formData, 'image', item.imageUri, `${id}.jpg`);
    const response = await fetch(`${apiUrl}/api/storage/upload`, {
      method: 'POST',
      headers: await authHeaders(user),
      body: formData,
    });
    if (!response.ok) throw new Error('Photo upload failed.');
    return (await response.json()) as Pick<
      ClothingItem,
      'imageUri' | 'imageSource' | 'objectKey'
    >;
  } catch {
    return { imageUri: item.imageUri, imageSource: item.imageSource };
  }
}

export async function deleteStoredImage(user: ClosetUser, objectKey?: string) {
  if (!apiUrl || !objectKey) return;
  await fetch(`${apiUrl}/api/storage/object`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders(user)) },
    body: JSON.stringify({ objectKey }),
  }).catch(() => undefined);
}

export async function refreshStoredImage(user: ClosetUser, item: ClothingItem) {
  if (!apiUrl || !item.objectKey) return item;
  try {
    const response = await fetch(
      `${apiUrl}/api/storage/url?key=${encodeURIComponent(item.objectKey)}`,
      { headers: await authHeaders(user) },
    );
    if (!response.ok) return item;
    const result = (await response.json()) as { imageUri: string };
    return { ...item, imageUri: result.imageUri };
  } catch {
    return item;
  }
}
