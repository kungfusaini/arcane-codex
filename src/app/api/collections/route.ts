import { NextRequest, NextResponse } from 'next/server';
import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';
import {
  CollectionProperty,
  CollectionViews,
  CollectionSchema,
  CollectionPropertyType,
} from '@/lib/data/types';

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

export async function GET() {
  const collections = listCollections();
  return NextResponse.json({ collections });
}

export async function POST(request: NextRequest) {
  const blocked = rejectPublishedMutation('Creating collections');
  if (blocked) return blocked;
  const payload = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    hostPageId?: unknown;
    schema?: unknown;
    views?: unknown;
  };

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const hostPageId = payload.hostPageId === null ? null : typeof payload.hostPageId === 'string' ? payload.hostPageId : undefined;

  try {
    const collection = createCollection({
      name,
      hostPageId,
      schema: parseCollectionSchema(payload.schema),
      views: parseCollectionViews(payload.views),
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Collection could not be created' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = rejectPublishedMutation('Editing collections');
  if (blocked) return blocked;
  const payload = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: unknown;
    hostPageId?: unknown;
    schema?: unknown;
    views?: unknown;
    deleteId?: string;
  };

  const collectionId = payload.id;
  if (!collectionId) {
    return NextResponse.json({ error: 'Missing collection id' }, { status: 400 });
  }

  if (payload.deleteId === collectionId) {
    deleteCollection(collectionId);
    return NextResponse.json({ ok: true });
  }

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
    const collection = updateCollection(collectionId, updates);
    return NextResponse.json({ collection });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Collection could not be updated' }, { status: 400 });
  }
}
