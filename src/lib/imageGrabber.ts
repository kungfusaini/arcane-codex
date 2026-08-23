export type ImageGrabberAsset = {
  id: string;
  filename: string;
  mimeType?: string;
  sha256?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  createdAt?: number;
};

export type GrabbedImage = {
  url: string;
  name: string;
  asset: ImageGrabberAsset;
};

export type WikimediaCommonsImageResult = {
  id: string;
  title: string;
  description: string;
  creator: string;
  license: string;
  pageUrl: string;
  imageUrl: string;
  thumbnailUrl: string;
  mimeType: string;
};

export const IMAGE_GRABBER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const IMAGE_GRABBER_UPLOAD_TYPES = [...IMAGE_GRABBER_IMAGE_TYPES, 'application/pdf', 'text/plain', 'text/markdown'];
export const IMAGE_GRABBER_MAX_BYTES = 20 * 1024 * 1024;

export function isSupportedGrabberUpload(file: File, allowedTypes: string[] = IMAGE_GRABBER_UPLOAD_TYPES): boolean {
  return file.size <= IMAGE_GRABBER_MAX_BYTES && allowedTypes.includes(file.type.toLowerCase());
}

export function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isLikelyImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function assetUrl(asset: Pick<ImageGrabberAsset, 'id'>): string {
  return `/api/assets/${asset.id}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export async function uploadGrabberAsset(file: File): Promise<ImageGrabberAsset> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/assets', { method: 'POST', body: form });
  const payload = await readJson<{ asset?: ImageGrabberAsset; error?: string }>(response);
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || 'Upload failed');
  }
  return payload.asset;
}

export async function searchWikimediaCommonsImages(query: string): Promise<WikimediaCommonsImageResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const response = await fetch(`/api/image-search/commons?q=${encodeURIComponent(trimmed)}`);
  const payload = await readJson<{ results?: WikimediaCommonsImageResult[]; error?: string }>(response);
  if (!response.ok) {
    throw new Error(payload.error || 'Wikimedia Commons search failed.');
  }
  return payload.results ?? [];
}

export async function importGrabberAssetFromUrl(url: string): Promise<ImageGrabberAsset> {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) {
    throw new Error('Enter a valid HTTP(S) image URL.');
  }
  const response = await fetch('/api/assets/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: normalized }),
  });
  const payload = await readJson<{ asset?: ImageGrabberAsset; error?: string }>(response);
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || 'Image import failed');
  }
  return payload.asset;
}

export async function grabImageFromUrl(url: string): Promise<GrabbedImage> {
  const asset = await importGrabberAssetFromUrl(url);
  return { asset, url: assetUrl(asset), name: asset.filename };
}

export async function grabImageFromFile(file: File): Promise<GrabbedImage> {
  const asset = await uploadGrabberAsset(file);
  return { asset, url: assetUrl(asset), name: asset.filename };
}

export async function generateGrabberImage(prompt: string, filename = 'generated-image.png'): Promise<GrabbedImage> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Describe the image first.');
  }
  const response = await fetch('/api/image-generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: trimmedPrompt, filename }),
  });
  const payload = await readJson<{ asset?: ImageGrabberAsset; error?: string }>(response);
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || 'Image generation failed.');
  }
  return { asset: payload.asset, url: assetUrl(payload.asset), name: payload.asset.filename };
}

export async function editGrabberImageToAsset(imageUrl: string, prompt: string): Promise<GrabbedImage> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Describe the image edit first.');
  }
  const source = imageUrl.startsWith('/') ? `${window.location.origin}${imageUrl}` : imageUrl;
  const editResponse = await fetch('/api/image-edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: source, prompt: trimmedPrompt }),
  });
  const editPayload = await readJson<{ image?: string; error?: string }>(editResponse);
  if (!editResponse.ok || !editPayload.image) {
    throw new Error(editPayload.error || 'Image edit failed.');
  }
  const imageBlob = await fetch(editPayload.image).then(async (result) => {
    if (!result.ok) throw new Error('Edited image could not be read.');
    return result.blob();
  });
  return grabImageFromFile(new File([imageBlob], 'codex-edit.png', { type: 'image/png' }));
}
