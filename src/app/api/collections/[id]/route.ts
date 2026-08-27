import { NextRequest, NextResponse } from 'next/server';
import { deleteCollection, updateCollection } from '@/lib/data/storage';
import { getCollectionDetailPayload } from '@/lib/data/collectionPayload';
import { CollectionProperty, CollectionPropertyType, CollectionSchema, CollectionViews } from '@/lib/data/types';

type CollectionPayload = {
  name?: unknown;
  hostPageId?: unknown;
  schema?: unknown;
  views?: unknown;
};

function parseCollectionType(candidate: unknown): CollectionProperty['type'] {
  return candidate === 'text' ||
    candidate === 'number' ||
    candidate === 'select' ||
    candidate === 'multi-select' ||
    candidate === 'checkbox' ||
    candidate === 'date' ||
    candidate === 'url'
    ? candidate
    : 'text';
}

function parseCollectionSchema(payload: unknown): CollectionSchema {
  if (!payload || typeof payload !== 'object') {
    return { properties: [] };
  }

  const candidate = payload as { properties?: unknown };
  if (!Array.isArray(candidate.properties)) {
    return { properties: [] };
  }

  const properties = candidate.properties
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const raw = entry as {
        id?: unknown;
        name?: unknown;
        type?: unknown;
        options?: unknown;
      };
      if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
        return null;
      }
      const rawType = parseCollectionType(raw.type);

      const property: CollectionProperty = {
        id: raw.id.trim(),
        name: raw.name.trim() || 'Property',
        type: rawType as CollectionPropertyType,
      };

      if (rawType === 'select' || rawType === 'multi-select') {
        const options = Array.isArray(raw.options)
          ? raw.options
              .map((option) => (typeof option === 'string' ? option.trim() : ''))
              .filter(Boolean)
          : [];
        property.options = [...new Set(options)];
      }

      return property;
    })
    .filter(Boolean) as CollectionProperty[];

  return { properties };
}

function parseCollectionViews(payload: unknown): CollectionViews {
  if (!payload || typeof payload !== 'object') {
    return { mode: 'table' };
  }

  const candidate = payload as {
    mode?: unknown;
    sort?: {
      propertyId?: unknown;
      direction?: unknown;
    };
    filter?: {
      propertyId?: unknown;
      query?: unknown;
    };
  };

  return {
    mode: candidate.mode === 'gallery' ? 'gallery' : 'table',
    sort:
      candidate.sort &&
      typeof candidate.sort.propertyId === 'string' &&
      (candidate.sort.direction === 'asc' || candidate.sort.direction === 'desc')
        ? {
            propertyId: candidate.sort.propertyId,
            direction: candidate.sort.direction,
          }
        : undefined,
    filter:
      candidate.filter &&
      typeof candidate.filter.propertyId === 'string' &&
      typeof candidate.filter.query === 'string' &&
      candidate.filter.propertyId.trim().length > 0
        ? {
            propertyId: candidate.filter.propertyId,
            query: candidate.filter.query,
          }
        : undefined,
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const payload = getCollectionDetailPayload(params.id, {
    sortBy: searchParams.get('sortBy') || 'sortKey',
    direction: searchParams.get('direction') === 'desc' ? 'desc' : 'asc',
    filterBy: searchParams.get('filterBy'),
    filterQuery: searchParams.get('filterQuery') || '',
  });

  if (!payload) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  return NextResponse.json(payload);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = (await request.json().catch(() => ({}))) as CollectionPayload;

  const updates: {
    name?: string;
    hostPageId?: string | null;
    schema?: CollectionSchema;
    views?: CollectionViews;
  } = {};

  if (Object.hasOwn(payload, 'name') && typeof payload.name === 'string') {
    updates.name = payload.name.trim();
  }
  if (Object.hasOwn(payload, 'hostPageId')) {
    updates.hostPageId = payload.hostPageId === null ? null : typeof payload.hostPageId === 'string' ? payload.hostPageId : null;
  }
  if (Object.hasOwn(payload, 'schema')) {
    updates.schema = parseCollectionSchema(payload.schema);
  }
  if (Object.hasOwn(payload, 'views')) {
    updates.views = parseCollectionViews(payload.views);
  }

  try {
    const collection = updateCollection(params.id, updates);
    return NextResponse.json({ collection });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  deleteCollection(params.id);
  return NextResponse.json({ ok: true });
}
