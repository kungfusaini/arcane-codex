import { NextRequest, NextResponse } from 'next/server';
import { unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { createAsset, type AssetCreateResult } from '@/lib/data/storage';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') {
    return true;
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || parts[0] === 0;
}

function isInsideTemp(filePath: string): boolean {
  const relative = path.relative(tmpdir(), filePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function startsWith(bytes: Buffer, signature: number[] | string, offset = 0): boolean {
  const expected = typeof signature === 'string' ? Buffer.from(signature, 'ascii') : Buffer.from(signature);
  return bytes.subarray(offset, offset + expected.length).equals(expected);
}

function contentMatchesMime(bytes: Buffer, mimeType: string): boolean {
  return mimeType === 'image/png'
    ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : mimeType === 'image/jpeg'
      ? startsWith(bytes, [0xff, 0xd8, 0xff])
      : mimeType === 'image/gif'
        ? startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a')
        : startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isWikimediaFilePage(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return (host.endsWith('wikipedia.org') || host === 'commons.wikimedia.org') && decodeURIComponent(url.pathname).includes('/wiki/File:');
}

function extractWikimediaImageUrl(html: string, baseUrl: URL): URL | null {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const href = ogImage?.[1];
  if (!href) return null;
  const imageUrl = new URL(decodeHtmlEntities(href), baseUrl);
  return imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:' ? imageUrl : null;
}

function safeFilename(url: URL, mimeType: string): string {
  const candidate = path.basename(url.pathname).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
  const extension = MIME_EXTENSIONS[mimeType];
  return candidate && candidate.includes('.') ? candidate : `remote-image${extension}`;
}

async function fetchImage(url: URL): Promise<{ bytes: Buffer; mimeType: string; sourceUrl: URL }> {
  let current = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (isBlockedHost(current.hostname)) {
      throw new Error('That image host is not allowed.');
    }
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The image URL redirected without a destination.');
      current = new URL(location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Error('The image URL must use HTTP or HTTPS.');
      continue;
    }
    if (!response.ok) throw new Error(`The image host returned ${response.status}.`);
    const mimeType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!IMAGE_TYPES.has(mimeType)) {
      if (mimeType === 'text/html' && isWikimediaFilePage(current)) {
        const imageUrl = extractWikimediaImageUrl(await response.text(), current);
        if (imageUrl) {
          current = imageUrl;
          continue;
        }
      }
      throw new Error('Use a direct PNG, JPEG, GIF, WebP image URL, or a Wikimedia File page.');
    }
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Use a PNG, JPEG, GIF, or WebP image under 20 MB.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES || !contentMatchesMime(bytes, mimeType)) throw new Error('The downloaded file is not a supported image.');
    return { bytes, mimeType, sourceUrl: current };
  }
  throw new Error('The image URL redirected too many times.');
}

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;
  try {
    const payload = (await request.json().catch(() => ({}))) as { url?: unknown };
    if (typeof payload.url !== 'string') throw new Error('An image URL is required.');
    const url = new URL(payload.url.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The image URL must use HTTP or HTTPS.');
    const image = await fetchImage(url);
    tempPath = path.join(tmpdir(), `arcane-image-import-${randomUUID()}`);
    if (!isInsideTemp(tempPath)) throw new Error('Import staging path is invalid.');
    writeFileSync(tempPath, image.bytes, { flag: 'wx', mode: 0o600 });
    const created: AssetCreateResult = createAsset({ filename: safeFilename(image.sourceUrl, image.mimeType), mimeType: image.mimeType, sourcePath: tempPath, width: null, height: null }, getDataDir());
    return NextResponse.json({ asset: created.asset, created: created.created }, { status: created.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Image import failed.' }, { status: 400 });
  } finally {
    if (tempPath && isInsideTemp(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* best effort */ }
    }
  }
}
