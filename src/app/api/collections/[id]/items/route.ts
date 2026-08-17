import { NextRequest, NextResponse } from 'next/server';
import { createCollectionItem, listCollectionItems, removeCollectionItem, updateCollectionItemProperties, applyCollectionItemMoves } from '@/lib/data/storage';

type CollectionItemChange = {
  pageId?: string;
  properties?: Record<string, unknown>;
  sortKey?: number;
  action?: string;
  moves?: Array<{ pageId?: string; sortKey?: number }>;
};

function parseProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = (await request.json().catch(() => ({}))) as {
    pageId?: unknown;
    properties?: unknown;
    sortKey?: unknown;
  };

  const pageId = typeof payload.pageId === 'string' ? payload.pageId : '';
  if (!pageId) {
    return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  }

  const sortKey = typeof payload.sortKey === 'number' && Number.isFinite(payload.sortKey) ? payload.sortKey : undefined;
  const properties = parseProperties(payload.properties);

  try {
    const item = createCollectionItem(
      {
        collectionId: params.id,
        pageId,
        sortKey,
        properties,
      },
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = (await request.json().catch(() => ({}))) as CollectionItemChange;

  if (payload.action === 'reorder') {
    const moves = Array.isArray(payload.moves)
      ? payload.moves
          .map((move) => {
            const pageId = typeof move.pageId === 'string' ? move.pageId : '';
            const sortKey = typeof move.sortKey === 'number' && Number.isFinite(move.sortKey) ? move.sortKey : NaN;
            if (!pageId || Number.isNaN(sortKey)) {
              return null;
            }
            return {
              collectionId: params.id,
              pageId,
              sortKey,
            };
          })
          .filter(Boolean)
      : [];

    if (!moves.length) {
      return NextResponse.json({ error: 'No moves provided' }, { status: 400 });
    }

    try {
      const items = applyCollectionItemMoves(moves as { collectionId: string; pageId: string; sortKey: number }[]);
      return NextResponse.json({ items });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  const pageId = typeof payload.pageId === 'string' ? payload.pageId : '';
  if (!pageId) {
    return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  }

  if (!payload.properties || typeof payload.properties !== 'object') {
    return NextResponse.json({ error: 'properties required' }, { status: 400 });
  }

  try {
    const item = updateCollectionItemProperties({
      collectionId: params.id,
      pageId,
      properties: payload.properties,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = (await request.json().catch(() => ({}))) as { pageId?: unknown };
  const pageId = typeof payload.pageId === 'string' ? payload.pageId : '';

  if (!pageId) {
    return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  }

  const items = listCollectionItems(params.id);
  if (!items.some((item) => item.pageId === pageId)) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  removeCollectionItem(params.id, pageId);
  return NextResponse.json({ ok: true });
}
