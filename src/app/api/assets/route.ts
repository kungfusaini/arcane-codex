import { NextRequest, NextResponse } from 'next/server';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { createAsset, AssetCreateResult, listAssets } from '@/lib/data/storage';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/plain', 'text/markdown'];

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

function isSupportedMime(type: string): boolean {
  if (!type) {
    return false;
  }
  return ALLOWED_MIME_PREFIXES.some((prefix) => type === prefix || type.startsWith(`${prefix} `) || type.startsWith(prefix));
}

function safeFilename(name: string): string {
  const trimmed = (name || 'upload').trim().slice(0, 120);
  return trimmed.replace(/[\\/]/g, '-').replace(/\.{2,}/g, '.');
}

function isAllowedPath(p: string): boolean {
  if (!path.isAbsolute(p)) {
    return false;
  }
  return p.startsWith(tmpdir());
}

async function writeUploadToTemp(file: File): Promise<string> {
  const safeName = `${Date.now()}-${randomUUID()}-${safeFilename(file.name || 'upload')}`;
  const tempPath = path.join(tmpdir(), safeName);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error('File too large');
  }

  const fs = await import('node:fs');
  fs.writeFileSync(tempPath, bytes);
  if (!isAllowedPath(tempPath)) {
    throw new Error('Invalid upload path');
  }
  return tempPath;
}

export async function GET() {
  const assets = listAssets(getDataDir());
  return NextResponse.json({ assets });
}

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    if (typeof file.name !== 'string' || file.name.length === 0) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const type = file.type || 'application/octet-stream';
    if (!isSupportedMime(type)) {
      return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 });
    }

    tempPath = await writeUploadToTemp(file);
    const created: AssetCreateResult = createAsset(
      {
        filename: safeFilename(file.name),
        mimeType: type,
        sourcePath: tempPath,
        width: null,
        height: null,
      },
      getDataDir(),
    );

    return NextResponse.json(
      {
        asset: created.asset,
        created: created.created,
      },
      { status: created.created ? 201 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    if (message === 'File too large') {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (tempPath && isAllowedPath(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // best effort cleanup
      }
    }
  }
}
