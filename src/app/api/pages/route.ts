import { NextRequest, NextResponse } from 'next/server';
import { createPage, getAsset, listPages, listPageSummaries, listTrashPages, listTrashPageSummaries, searchPageSummaries, searchPages } from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeDeleted = searchParams.get('includeDeleted') === 'true';
  const includeContent = searchParams.get('includeContent') === 'true';
  const includeCollectionPages = searchParams.get('includeCollectionPages') !== 'false';
  const query = searchParams.get('query')?.trim();

  if (query && query.length > 0) {
    const pages = includeContent
      ? searchPages(query, undefined, includeCollectionPages)
      : searchPageSummaries(query, undefined, includeCollectionPages);
    return NextResponse.json({ pages });
  }

  const pages = includeContent
    ? includeDeleted
      ? listTrashPages()
      : listPages(undefined, includeCollectionPages)
    : includeDeleted
      ? listTrashPageSummaries()
      : listPageSummaries(undefined, includeCollectionPages);
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
  const blocked = rejectPublishedMutation('Creating pages');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({}));
  const title = String(payload.title ?? '').trim() || 'Untitled';
  const parentId = payload.parentId === null || typeof payload.parentId === 'string' ? payload.parentId : null;

  const sortKey =
    typeof payload.sortKey === 'number' && Number.isFinite(payload.sortKey)
      ? payload.sortKey
      : undefined;

  if (payload.iconAssetId != null) {
    if (typeof payload.iconAssetId !== 'string') {
      return NextResponse.json({ error: 'Icon asset id must be a string or null.' }, { status: 400 });
    }
    const iconAsset = getAsset(payload.iconAssetId);
    if (!iconAsset || !iconAsset.mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Icon asset must reference an uploaded image.' }, { status: 400 });
    }
  }

  const page = createPage({
    parentId,
    sortKey,
    title,
    icon: payload.iconAssetId ? null : payload.icon ?? null,
    iconAssetId: payload.iconAssetId ?? null,
    coverAssetId: payload.coverAssetId ?? null,
    coverFocalX: clampFocal(payload.coverFocalX),
    coverFocalY: clampFocal(payload.coverFocalY),
    isArticle: payload.isArticle === true,
    contentJson: payload.contentJson ?? '[]',
  });

  return NextResponse.json({ page }, { status: 201 });
}
