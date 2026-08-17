import { NextRequest, NextResponse } from 'next/server';
import { deleteCollection, getCollection, listCollectionItems, listPages, updateCollection } from '@/lib/data/storage';
import { CollectionPropertyType, CollectionSchema, CollectionViews } from '@/lib/data/types';

type CollectionProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options?: string[];
};

type CollectionPayload = {
  name?: unknown;
  hostPageId?: unknown;
  schema?: unknown;
  views?: unknown;
};

type EnrichedCollectionItem = {
  collectionId: string;
  pageId: string;
  propertiesJson: string;
  sortKey: number;
  page: {
    id: string;
    parentId: string | null;
    title: string;
    icon: string | null;
    coverAssetId: string | null;
    contentJson: string;
    revision: number;
    createdAt: number;
    updatedAt: number;
  };
};

function parseCollectionType(candidate: unknown): CollectionPropertyType {
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

      const type = parseCollectionType(raw.type);
      return {
        id: raw.id.trim(),
        name: raw.name.trim() || 'Property',
        type,
        options:
          type === 'select' || type === 'multi-select'
            ? Array.from(new Set(
                Array.isArray(raw.options)
                  ? raw.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
                  : [],
              ))
            : undefined,
      } as CollectionProperty;
    })
    .filter((property): property is CollectionProperty => Boolean(property));

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

function parseProperties(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parsing errors
  }
  return {};
}

function normalizeText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function compareItems(
  a: EnrichedCollectionItem,
  b: EnrichedCollectionItem,
  property?: string,
  direction: 'asc' | 'desc' = 'asc',
  properties: CollectionProperty[] = [],
): number {
  const aProps = parseProperties(a.propertiesJson);
  const bProps = parseProperties(b.propertiesJson);
  const reverse = direction === 'desc' ? -1 : 1;

  if (property === 'title') {
    return a.page.title.localeCompare(b.page.title) * reverse;
  }

  const definition = properties.find((entry) => entry.id === property);
  if (!definition) {
    return a.sortKey > b.sortKey ? reverse : a.sortKey < b.sortKey ? -reverse : 0;
  }

  if (definition.type === 'number') {
    const aNumber = normalizeNumber(aProps[definition.id]);
    const bNumber = normalizeNumber(bProps[definition.id]);
    if (Number.isNaN(aNumber) && Number.isNaN(bNumber)) {
      return 0;
    }
    if (Number.isNaN(aNumber)) {
      return 1;
    }
    if (Number.isNaN(bNumber)) {
      return -1;
    }
    return (aNumber - bNumber) * reverse;
  }

  if (definition.type === 'checkbox') {
    const aFlag = Boolean(aProps[definition.id]);
    const bFlag = Boolean(bProps[definition.id]);
    if (aFlag === bFlag) {
      return 0;
    }
    return (aFlag ? 1 : -1) * reverse;
  }

  if (definition.type === 'date') {
    const aDate = Date.parse(normalizeText(aProps[definition.id]));
    const bDate = Date.parse(normalizeText(bProps[definition.id]));
    if (Number.isNaN(aDate) && Number.isNaN(bDate)) {
      return 0;
    }
    if (Number.isNaN(aDate)) {
      return 1;
    }
    if (Number.isNaN(bDate)) {
      return -1;
    }
    return (aDate - bDate) * reverse;
  }

  return normalizeText(aProps[definition.id]).localeCompare(normalizeText(bProps[definition.id])) * reverse;
}

function applyFilter(items: EnrichedCollectionItem[], propertyId: string | null, query: string): EnrichedCollectionItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!propertyId || !trimmed) {
    return items;
  }

  return items.filter((item) => {
    const properties = parseProperties(item.propertiesJson);
    const raw = properties[propertyId];

    if (Array.isArray(raw)) {
      return raw.join(',').toLowerCase().includes(trimmed);
    }

    const text = normalizeText(raw).toLowerCase();
    return text.includes(trimmed);
  });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const collection = getCollection(params.id);
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get('sortBy') || 'sortKey';
  const direction = searchParams.get('direction') === 'desc' ? 'desc' : 'asc';
  const filterBy = searchParams.get('filterBy');
  const filterQuery = searchParams.get('filterQuery') || '';

  const allPages = listPages();
  const pageById = new Map(allPages.map((page) => [page.id, page]));

  const items = listCollectionItems(params.id)
    .map((item) => {
      const page = pageById.get(item.pageId);
      if (!page || page.deletedAt !== null) {
        return null;
      }

      return {
        ...item,
        page: {
          id: page.id,
          parentId: page.parentId,
          title: page.title,
          icon: page.icon,
          coverAssetId: page.coverAssetId,
          contentJson: page.contentJson,
          revision: page.revision,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
        },
      } satisfies EnrichedCollectionItem;
    })
    .filter((item): item is EnrichedCollectionItem => Boolean(item));

  let ordered = [...items];  let parsedSchema: CollectionSchema;
  try {
    parsedSchema = JSON.parse(collection.schemaJson) as CollectionSchema;
  } catch {
    parsedSchema = { properties: [] };
  }

  if (filterBy) {
    ordered = applyFilter(ordered, filterBy, filterQuery);
  }

  if (sortBy) {
    ordered.sort((a, b) => compareItems(a, b, sortBy, direction, parsedSchema.properties));
  } else {
    ordered.sort((a, b) => a.sortKey - b.sortKey);
  }

  const joinedPageIds = new Set(items.map((item) => item.pageId));
  const availablePages = allPages.filter((page) => !joinedPageIds.has(page.id));

  return NextResponse.json({ collection, items: ordered, availablePages, schema: parsedSchema, views: collection.viewsJson });
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
