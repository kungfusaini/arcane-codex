import { NextRequest, NextResponse } from 'next/server';
import { unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { createAsset, type AssetCreateResult, listAssets } from '@/lib/data/storage';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.text'],
  'text/markdown': ['.md', '.markdown'],
};

class UploadValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadValidationError';
    this.status = status;
  }
}

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

function safeFilename(name: string): string {
  const trimmed = name.trim().slice(0, 120);
  return trimmed.replace(/[\\/]/g, '-').replace(/\.{2,}/g, '.').replace(/[\u0000-\u001f\u007f]/g, '');
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
  switch (mimeType) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a');
    case 'image/webp':
      return startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8);
    case 'application/pdf':
      return startsWith(bytes, '%PDF-');
    case 'text/plain':
    case 'text/markdown':
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

async function validateUpload(file: File): Promise<{ bytes: Buffer; filename: string; mimeType: string }> {
  const filename = safeFilename(file.name || '');
  if (!filename || filename === '.' || filename === '..') {
    throw new UploadValidationError('Choose a file with a valid name.');
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw new UploadValidationError('File is larger than the 20 MB upload limit.', 413);
  }

  const mimeType = file.type.toLowerCase();
  const extensions = MIME_EXTENSIONS[mimeType];
  if (!extensions) {
    throw new UploadValidationError('Unsupported file type. Use PNG, JPEG, GIF, WebP, PDF, text, or Markdown.');
  }
  const extension = path.extname(filename).toLowerCase();
  if (!extensions.includes(extension)) {
    throw new UploadValidationError(`The ${extension || 'missing'} extension does not match ${mimeType}.`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !contentMatchesMime(bytes, mimeType)) {
    throw new UploadValidationError('File contents do not match the declared file type.');
  }
  return { bytes, filename, mimeType };
}

export async function GET() {
  try {
    return NextResponse.json({ assets: listAssets(getDataDir()) });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Media library could not be loaded.',
        detail: error instanceof Error ? error.message : 'Workspace unavailable',
        recovery: 'Run the workspace health check and restore missing workspace files before retrying.',
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw new UploadValidationError('Choose a file to upload.');
    }

    const validated = await validateUpload(file);
    tempPath = path.join(tmpdir(), `arcane-upload-${randomUUID()}`);
    if (!isInsideTemp(tempPath)) {
      throw new UploadValidationError('Upload staging path is invalid.');
    }
    writeFileSync(tempPath, validated.bytes, { flag: 'wx', mode: 0o600 });

    const created: AssetCreateResult = createAsset(
      {
        filename: validated.filename,
        mimeType: validated.mimeType,
        sourcePath: tempPath,
        width: null,
        height: null,
      },
      getDataDir(),
    );

    return NextResponse.json(
      { asset: created.asset, created: created.created },
      { status: created.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: 'Upload could not be stored.',
        detail: error instanceof Error ? error.message : 'Unknown upload error',
        recovery: 'Your original file was not changed. Check workspace health and retry.',
      },
      { status: 500 },
    );
  } finally {
    if (tempPath && isInsideTemp(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup; the randomized staging file contains only the uploaded bytes.
      }
    }
  }
}
