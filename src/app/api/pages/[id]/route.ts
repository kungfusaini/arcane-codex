import { NextRequest, NextResponse } from 'next/server';
import { duplicatePage, getAsset, getPage, listCollectionsForPage, listCollectionsHostedByPage, readBacklinks, trashPage, updatePage } from '@/lib/data/storage';
import { RevisionConflictError } from '@/lib/data/types';
import { rejectPublishedMutation } from '@/lib/surface';

type PageUpdatePayload = {
  revision?: number;
  title?: string;
  icon?: string | null;
  iconAssetId?: string | null;
  coverAssetId?: string | null;
  coverFocalX?: number;
  coverFocalY?: number;
  coverScale?: number;
  isArticle?: boolean;
  tags?: string[];
  parentId?: string | null;
  sortKey?: number;
  contentJson?: string;
};

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

function clampCoverScale(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 100) {
    return 100;
  }
  if (value > 200) {
    return 200;
  }
  return value;
}

function parseTags(value: unknown): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    return null;
  }
  return [...new Set(value.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const page = getPage(params.id);
  if (!page) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const backlinks = readBacklinks(params.id);
  const collections = listCollectionsForPage(params.id);
  const hostCollection = listCollectionsHostedByPage(params.id)[0] ?? null;
  return NextResponse.json({ page, backlinks, collections, hostCollection });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const blocked = rejectPublishedMutation('Editing pages');
  if (blocked) return blocked;
  const payload = (await request.json().catch(() => ({}))) as PageUpdatePayload;

  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 0) {
    return NextResponse.json({ error: 'A non-negative revision number is required.' }, { status: 400 });
  }
  if (typeof payload.title === 'string' && payload.title.length > 500) {
    return NextResponse.json({ error: 'Page titles must be 500 characters or fewer.' }, { status: 400 });
  }
  if (payload.icon != null && (typeof payload.icon !== 'string' || payload.icon.length > 32)) {
    return NextResponse.json({ error: 'Page icons must be a short text or emoji value.' }, { status: 400 });
  }
  if (Object.hasOwn(payload, 'coverFocalX') && clampFocal(payload.coverFocalX) === undefined) {
    return NextResponse.json({ error: 'coverFocalX must be a finite number between 0 and 100.' }, { status: 400 });
  }
  if (Object.hasOwn(payload, 'coverFocalY') && clampFocal(payload.coverFocalY) === undefined) {
    return NextResponse.json({ error: 'coverFocalY must be a finite number between 0 and 100.' }, { status: 400 });
  }
  if (Object.hasOwn(payload, 'coverScale') && clampCoverScale(payload.coverScale) === undefined) {
    return NextResponse.json({ error: 'coverScale must be a finite number between 100 and 200.' }, { status: 400 });
  }
  if (typeof payload.contentJson === 'string') {
    if (Buffer.byteLength(payload.contentJson, 'utf8') > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Page content is too large to save.' }, { status: 413 });
    }
    try {
      if (!Array.isArray(JSON.parse(payload.contentJson))) {
        return NextResponse.json({ error: 'Page content must be a JSON block array.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Page content contains invalid JSON.' }, { status: 400 });
    }
  }
  const tags = Object.hasOwn(payload, 'tags') ? parseTags(payload.tags) : undefined;
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
  if (payload.coverAssetId != null) {
    if (typeof payload.coverAssetId !== 'string') {
      return NextResponse.json({ error: 'Cover asset id must be a string or null.' }, { status: 400 });
    }
    const cover = getAsset(payload.coverAssetId);
    if (!cover || !cover.mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Cover asset must reference an uploaded image.' }, { status: 400 });
    }
  }

  try {
    const updates: NonNullable<Parameters<typeof updatePage>[1]> = {
      revision,
    };

    if (Object.hasOwn(payload, 'title') && typeof payload.title === 'string') {
      updates.title = payload.title;
    }
    if (Object.hasOwn(payload, 'icon')) {
      updates.icon = payload.icon ?? null;
      if (payload.icon != null) updates.iconAssetId = null;
    }
    if (Object.hasOwn(payload, 'iconAssetId')) {
      updates.iconAssetId = payload.iconAssetId ?? null;
      if (payload.iconAssetId) updates.icon = null;
    }
    if (Object.hasOwn(payload, 'coverAssetId')) {
      updates.coverAssetId = payload.coverAssetId ?? null;
    }
    if (Object.hasOwn(payload, 'coverFocalX')) {
      updates.coverFocalX = clampFocal(payload.coverFocalX);
    }
    if (Object.hasOwn(payload, 'coverFocalY')) {
      updates.coverFocalY = clampFocal(payload.coverFocalY);
    }
    if (Object.hasOwn(payload, 'coverScale')) {
      updates.coverScale = clampCoverScale(payload.coverScale);
    }
    if (Object.hasOwn(payload, 'isArticle')) {
      updates.isArticle = payload.isArticle === true;
    }
    if (tags !== undefined) {
      updates.tags = tags;
    }
    if (Object.hasOwn(payload, 'parentId')) {
      updates.parentId = payload.parentId ?? null;
    }
    if (Object.hasOwn(payload, 'sortKey') && typeof payload.sortKey === 'number') {
      updates.sortKey = payload.sortKey;
    }
    if (Object.hasOwn(payload, 'contentJson') && typeof payload.contentJson === 'string') {
      updates.contentJson = payload.contentJson;
    }

    const page = updatePage(params.id, updates);
    return NextResponse.json({ page, backlinks: readBacklinks(params.id) });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'REVISION_CONFLICT',
          current: getPage(params.id),
          recovery: 'Your draft was not applied. Reload the latest page or explicitly save your draft over it.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Update failed',
        recovery: 'Reload the page and retry. Your editor draft remains in this browser.',
      },
      { status: 400 },
    );
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const blocked = rejectPublishedMutation('Moving pages to trash');
  if (blocked) return blocked;
  const existing = getPage(params.id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  trashPage(params.id);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const blocked = rejectPublishedMutation('Duplicating pages');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({}));
  const action = payload.action;

  if (action === 'duplicate') {
    const page = duplicatePage(params.id);
    if (!page) {
      return NextResponse.json({ error: 'Source page missing' }, { status: 404 });
    }
    return NextResponse.json({ page });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
