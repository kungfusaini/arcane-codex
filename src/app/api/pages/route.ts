import { NextRequest, NextResponse } from 'next/server';
import { createPage, listPages, listTrashPages, searchPages } from '@/lib/data/storage';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeDeleted = searchParams.get('includeDeleted') === 'true';
  const query = searchParams.get('query')?.trim();

  if (query && query.length > 0) {
    const pages = searchPages(query);
    return NextResponse.json({ pages });
  }

  const pages = includeDeleted ? listTrashPages() : listPages();
  return NextResponse.json({ pages });
}

function clampFocal(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const title = String(payload.title ?? '').trim() || 'Untitled';
  const parentId = payload.parentId === null || typeof payload.parentId === 'string' ? payload.parentId : null;

  const sortKey =
    typeof payload.sortKey === 'number' && Number.isFinite(payload.sortKey)
      ? payload.sortKey
      : undefined;

  const page = createPage({
    parentId,
    sortKey,
    title,
    icon: payload.icon ?? null,
    coverAssetId: payload.coverAssetId ?? null,
    coverFocalX: clampFocal(payload.coverFocalX),
    coverFocalY: clampFocal(payload.coverFocalY),
    contentJson: payload.contentJson ?? '[]',
  });

  return NextResponse.json({ page }, { status: 201 });
}
