import { NextRequest, NextResponse } from 'next/server';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ensureIconVariant, getAssetFilePath, getIconVariantPath, getImageVariantConfig, type AssetImageVariant } from '@/lib/data/assetDerivatives';
import { getWorkspaceDbPath } from '@/lib/data/workspace';

type AssetMetadata = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

function getAssetMetadata(assetId: string, dataDir?: string): AssetMetadata | null {
  const dbPath = getWorkspaceDbPath(dataDir);
  if (!existsSync(dbPath)) {
    return null;
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare('SELECT id, filename, mime_type, size FROM assets WHERE id = ?')
      .get(assetId) as { id: string; filename: string; mime_type: string; size: number } | undefined;
    return row
      ? {
          id: String(row.id),
          filename: String(row.filename),
          mimeType: String(row.mime_type),
          size: Number(row.size),
        }
      : null;
  } finally {
    db.close();
  }
}

function streamFile(filePath: string, headers: Record<string, string>): NextResponse {
  return new NextResponse(Readable.toWeb(createReadStream(filePath)) as BodyInit, { headers });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const dataDir = getDataDir();
  const asset = getAssetMetadata(params.id, dataDir);
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = getAssetFilePath(asset, dataDir);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Asset missing on disk' }, { status: 410 });
  }

  const requestedVariant = request.nextUrl.searchParams.get('variant');
  const variant: AssetImageVariant | null = requestedVariant === 'icon' || requestedVariant === 'page-icon' ? requestedVariant : null;
  if (variant) {
    if (!asset.mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Icon variants are only available for images.' }, { status: 415 });
    }

    const variantPath = getIconVariantPath(asset.id, dataDir, variant);
    try {
      await ensureIconVariant(filePath, variantPath, variant);
    } catch (error) {
      return NextResponse.json(
        { error: 'Icon variant could not be generated.', detail: error instanceof Error ? error.message : 'Unknown image processing error' },
        { status: 500 },
      );
    }

    return streamFile(variantPath, {
      'Content-Type': 'image/webp',
      'Content-Length': String(statSync(variantPath).size),
      'Content-Disposition': `inline; filename="${asset.id}-${getImageVariantConfig(variant).suffix}.webp"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  }

  return streamFile(filePath, {
    'Content-Type': asset.mimeType,
    'Content-Length': String(asset.size),
    'Content-Disposition': `inline; filename="${asset.filename}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
}
