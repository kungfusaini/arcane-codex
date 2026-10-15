import { NextRequest, NextResponse } from 'next/server';
import { createPage, getAsset, listPages, listPageSummaries, listPublishedPages, listTrashPages, listTrashPageSummaries, searchPageSummaries, searchPages } from '@/lib/data/storage';
import { isPublishedAppSurface, rejectPublishedMutation } from '@/lib/surface';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeDeleted = searchParams.get('includeDeleted') === 'true';
  const published = isPublishedAppSurface() || searchParams.get('published') === 'true';
  const includeContent = searchParams.get('includeContent') === 'true';
  const includeCollectionPages = searchParams.get('includeCollectionPages') !== 'false';
  const query = searchParams.get('query')?.trim();

  if (query && query.length > 0) {
    const pages = includeContent
      ? searchPages(query, undefined, includeCollectionPages)
      : searchPageSummaries(query, undefined, includeCollectionPages);
    return NextResponse.json({ pages });
  }

  if (published) {
    return NextResponse.json({ pages: listPublishedPages(false, undefined, false) });
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

function parseTags(input: unknown): string[] | null {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    return null;
  }
  const tags = input.every((tag) => typeof tag === 'string') ? input.map((tag) => tag.trim()).filter(Boolean) : null;
  return tags === null ? null : [...new Set(tags)].slice(0, 20);
}

export async function POST(request: NextRequest) {
  const blocked = rejectPublishedMutation('Creating pages');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({}));
  const title = String(payload.title ?? '').trim() || 'Untitled';
  const bodyMarkdown = typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown : '';
  if (Buffer.byteLength(bodyMarkdown, 'utf8') > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Page content is too large to save.' }, { status: 413 });
  }
  const parentId = payload.parentId === null || typeof payload.parentId === 'string' ? payload.parentId : null;

  const sortKey =
    typeof payload.sortKey === 'number' && Number.isFinite(payload.sortKey)
      ? payload.sortKey
      : undefined;

  const tags = parseTags(payload.tags);
  if (tags === null) {
    return NextResponse.json({ error: 'Page tags must be an array of strings.' }, { status: 400 });
  }

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
    kind: payload.kind === 'page' || payload.kind === 'article' || payload.kind === 'project' || payload.kind === 'fiction' ? payload.kind : 'note',
    summary: typeof payload.summary === 'string' ? payload.summary.trim().slice(0, 240) : '',
    tags,
    bodyMarkdown,
  });

  return NextResponse.json({ page }, { status: 201 });
}
