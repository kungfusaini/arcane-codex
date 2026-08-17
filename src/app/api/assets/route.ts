import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAsset, listAssets } from '@/lib/data/storage';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/plain', 'text/markdown'];

function isSupportedMime(type: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix));
}

async function writeUploadToTemp(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error('File too large');
  }
  const safeName = `${Date.now()}-${randomUUID()}-${file.name || 'upload'}`;
  const tempPath = path.join(tmpdir(), safeName);
  writeFileSync(tempPath, bytes);
  return tempPath;
}

export async function GET() {
  const assets = listAssets();
  return NextResponse.json({ assets });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    if (!isSupportedMime(file.type || 'application/octet-stream')) {
      return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 });
    }

    const tempPath = await writeUploadToTemp(file);
    const asset = createAsset({
      filename: file.name || 'uploaded-file',
      mimeType: file.type || 'application/octet-stream',
      sourcePath: tempPath,
      width: null,
      height: null,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    if (message === 'File too large') {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
