import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'node:fs';
import { getAsset, getAssetPathFromId } from '@/lib/data/storage';

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const asset = getAsset(params.id, getDataDir());
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = getAssetPathFromId(asset.id, getDataDir());
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Asset missing on disk' }, { status: 410 });
  }

  const stream = createReadStream(filePath);
  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'Content-Disposition': `inline; filename="${asset.filename}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
