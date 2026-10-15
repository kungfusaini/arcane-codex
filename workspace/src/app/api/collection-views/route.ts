import { NextRequest, NextResponse } from 'next/server';
import {
  createCollectionView,
  embedCollectionView,
  listCollectionViews,
  removeCollectionViewEmbed,
} from '@/lib/data/storage';
import type { CollectionViews } from '@/lib/data/types';
import { rejectPublishedMutation } from '@/lib/surface';

function parseSettings(value: unknown): CollectionViews {
  if (!value || typeof value !== 'object') return { mode: 'table' };
  const candidate = value as Partial<CollectionViews>;
  return {
    mode: candidate.mode === 'gallery' ? 'gallery' : 'table',
    sort: candidate.sort && typeof candidate.sort.propertyId === 'string' && (candidate.sort.direction === 'asc' || candidate.sort.direction === 'desc')
      ? candidate.sort
      : undefined,
    filter: candidate.filter && typeof candidate.filter.propertyId === 'string' && typeof candidate.filter.query === 'string'
      ? candidate.filter
      : undefined,
  };
}

export async function GET(request: NextRequest) {
  const collectionId = new URL(request.url).searchParams.get('collectionId');
  if (!collectionId) return NextResponse.json({ error: 'collectionId required' }, { status: 400 });
  return NextResponse.json({ views: listCollectionViews(collectionId) });
}

export async function POST(request: NextRequest) {
  const blocked = rejectPublishedMutation('Editing collection views');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (payload.action === 'embed') {
      if (typeof payload.pageId !== 'string' || typeof payload.viewId !== 'string') {
        return NextResponse.json({ error: 'pageId and viewId required' }, { status: 400 });
      }
      const embed = embedCollectionView(payload.pageId, payload.viewId, typeof payload.sortKey === 'number' ? payload.sortKey : 0);
      return NextResponse.json({ embed }, { status: 201 });
    }
    if (typeof payload.collectionId !== 'string') {
      return NextResponse.json({ error: 'collectionId required' }, { status: 400 });
    }
    const view = createCollectionView(payload.collectionId, {
      name: typeof payload.name === 'string' ? payload.name : 'View',
      settings: parseSettings(payload.settings),
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Collection view update failed' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = rejectPublishedMutation('Editing collection views');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof payload.pageId !== 'string' || typeof payload.viewId !== 'string') {
    return NextResponse.json({ error: 'pageId and viewId required' }, { status: 400 });
  }
  removeCollectionViewEmbed(payload.pageId, payload.viewId);
  return NextResponse.json({ ok: true });
}
