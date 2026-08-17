import { NextRequest, NextResponse } from 'next/server';
import { getPage, readBacklinks, duplicatePage, trashPage, updatePage } from '@/lib/data/storage';
import { RevisionConflictError } from '@/lib/data/types';

type PageUpdatePayload = {
  revision?: number;
  title?: string;
  icon?: string | null;
  coverAssetId?: string | null;
  parentId?: string | null;
  sortKey?: number;
  contentJson?: string;
};

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const page = getPage(params.id);
  if (!page) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const backlinks = readBacklinks(params.id);
  return NextResponse.json({ page, backlinks });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = (await request.json().catch(() => ({}))) as PageUpdatePayload;

  const revision = Number(payload.revision);
  if (!Number.isFinite(revision)) {
    return NextResponse.json({ error: 'revision required' }, { status: 400 });
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
    }
    if (Object.hasOwn(payload, 'coverAssetId')) {
      updates.coverAssetId = payload.coverAssetId ?? null;
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
    return NextResponse.json({ page });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Update failed' }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const existing = getPage(params.id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  trashPage(params.id);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
