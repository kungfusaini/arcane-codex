import { getCollection, listCollectionItems, listPages } from './storage';
import type { CollectionOptionColor, CollectionPropertyType, CollectionSchema } from './types';

type CollectionProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options?: string[];
  optionColors?: Record<string, CollectionOptionColor>;
};

export type CollectionPayloadItem = {
  collectionId: string;
  pageId: string;
  propertiesJson: string;
  sortKey: number;
  page: {
    id: string;
    parentId: string | null;
    sortKey: number;
    title: string;
    icon: string | null;
    iconAssetId: string | null;
    coverAssetId: string | null;
    coverFocalX: number;
    coverFocalY: number;
    coverScale: number;
    firstImageUrl: string | null;
    revision: number;
    createdAt: number;
    updatedAt: number;
  };
};

export type CollectionDetailPayload = {
  collection: NonNullable<ReturnType<typeof getCollection>>;
  hostPage: {
    id: string;
    parentId: string | null;
    sortKey: number;
    title: string;
    icon: string | null;
    iconAssetId: string | null;
    coverAssetId: string | null;
    coverFocalX: number;
    coverFocalY: number;
    coverScale: number;
    previewText: string;
  } | null;
  items: CollectionPayloadItem[];
  availablePages: Array<{
    id: string;
    parentId: string | null;
    sortKey: number;
    title: string;
    icon: string | null;
    iconAssetId: string | null;
    coverAssetId: string | null;
    revision: number;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
  }>;
  schema: CollectionSchema;
  views: string;
};

export type CollectionPayloadOptions = {
  sortBy?: string;
  direction?: 'asc' | 'desc';
  filterBy?: string | null;
  filterQuery?: string;
};

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
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function compareItems(
  a: CollectionPayloadItem,
  b: CollectionPayloadItem,
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
    if (Number.isNaN(aNumber) && Number.isNaN(bNumber)) return 0;
    if (Number.isNaN(aNumber)) return 1;
    if (Number.isNaN(bNumber)) return -1;
    return (aNumber - bNumber) * reverse;
  }

  if (definition.type === 'checkbox') {
    const aFlag = Boolean(aProps[definition.id]);
    const bFlag = Boolean(bProps[definition.id]);
    if (aFlag === bFlag) return 0;
    return (aFlag ? 1 : -1) * reverse;
  }

  if (definition.type === 'date') {
    const aDate = Date.parse(normalizeText(aProps[definition.id]));
    const bDate = Date.parse(normalizeText(bProps[definition.id]));
    if (Number.isNaN(aDate) && Number.isNaN(bDate)) return 0;
    if (Number.isNaN(aDate)) return 1;
    if (Number.isNaN(bDate)) return -1;
    return (aDate - bDate) * reverse;
  }

  return normalizeText(aProps[definition.id]).localeCompare(normalizeText(bProps[definition.id])) * reverse;
}

function extractFirstImageUrl(contentJson: string): string | null {
  if (!contentJson) return null;

  try {
    const content = JSON.parse(contentJson) as unknown;
    const walk = (node: unknown): string | null => {
      if (!node || typeof node !== 'object') return null;

      if (Array.isArray(node)) {
        for (const child of node) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      }

      const record = node as {
        type?: unknown;
        props?: { url?: unknown; fileUrl?: unknown; source?: unknown; images?: unknown };
        children?: unknown;
        content?: unknown;
      };

      if (record.type === 'gallery' && typeof record.props?.images === 'string') {
        try {
          const images = JSON.parse(record.props.images) as unknown;
          if (Array.isArray(images)) {
            const firstImage = images.find((item) => item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') as { url?: string } | undefined;
            if (firstImage?.url) return firstImage.url;
          }
        } catch {
          // Keep walking malformed gallery props.
        }
      }

      if (record.type === 'image') {
        const candidate =
          (typeof record.props?.url === 'string' ? record.props.url : undefined) ||
          (typeof record.props?.fileUrl === 'string' ? record.props.fileUrl : undefined) ||
          (typeof record.props?.source === 'string' ? record.props.source : undefined);
        if (candidate) return candidate;
      }

      return walk(record.children) || walk(record.content);
    };

    return walk(content);
  } catch {
    return null;
  }
}

function collectInlineText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const text = (item as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContentPreview(contentJson: string): string {
  if (!contentJson) return '';

  try {
    const content = JSON.parse(contentJson) as unknown;
    const pieces: string[] = [];
    const walk = (node: unknown): void => {
      if (pieces.length >= 2 || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
          if (pieces.length >= 2) break;
        }
        return;
      }

      const record = node as { type?: unknown; content?: unknown; children?: unknown };
      if (record.type === 'paragraph' || record.type === 'quote' || record.type === 'heading') {
        const text = collectInlineText(record.content);
        if (text) pieces.push(text);
      }
      walk(record.children);
      walk(record.content);
    };

    walk(content);
    return pieces.join(' ');
  } catch {
    return '';
  }
}

function applyFilter(items: CollectionPayloadItem[], propertyId: string | null | undefined, query: string): CollectionPayloadItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!propertyId || !trimmed) return items;

  return items.filter((item) => {
    const properties = parseProperties(item.propertiesJson);
    const raw = properties[propertyId];
    if (Array.isArray(raw)) return raw.join(',').toLowerCase().includes(trimmed);
    return normalizeText(raw).toLowerCase().includes(trimmed);
  });
}

function parseSchema(schemaJson: string): CollectionSchema {
  try {
    return JSON.parse(schemaJson) as CollectionSchema;
  } catch {
    return { properties: [] };
  }
}

export function getCollectionDetailPayload(collectionId: string, options: CollectionPayloadOptions = {}): CollectionDetailPayload | null {
  const collection = getCollection(collectionId);
  if (!collection) return null;

  const sortBy = options.sortBy || 'sortKey';
  const direction = options.direction === 'desc' ? 'desc' : 'asc';
  const filterQuery = options.filterQuery || '';
  const parsedSchema = parseSchema(collection.schemaJson);

  const allPages = listPages();
  const pageById = new Map(allPages.map((page) => [page.id, page]));
  const items = listCollectionItems(collectionId)
    .map((item) => {
      const page = pageById.get(item.pageId);
      if (!page || page.deletedAt !== null) return null;

      return {
        ...item,
        page: {
          id: page.id,
          parentId: page.parentId,
          sortKey: page.sortKey,
          title: page.title,
          icon: page.icon,
          iconAssetId: page.iconAssetId,
          coverAssetId: page.coverAssetId,
          coverFocalX: page.coverFocalX,
          coverFocalY: page.coverFocalY,
          coverScale: page.coverScale,
          firstImageUrl: page.coverAssetId ? `/api/assets/${page.coverAssetId}` : extractFirstImageUrl(page.contentJson),
          revision: page.revision,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
        },
      } satisfies CollectionPayloadItem;
    })
    .filter((item): item is CollectionPayloadItem => Boolean(item));

  let ordered = [...items];
  if (options.filterBy) ordered = applyFilter(ordered, options.filterBy, filterQuery);
  if (sortBy) ordered.sort((a, b) => compareItems(a, b, sortBy, direction, parsedSchema.properties));
  else ordered.sort((a, b) => a.sortKey - b.sortKey);

  const joinedPageIds = new Set(items.map((item) => item.pageId));
  const availablePages = allPages
    .filter((page) => !joinedPageIds.has(page.id))
    .map((page) => ({
      id: page.id,
      parentId: page.parentId,
      sortKey: page.sortKey,
      title: page.title,
      icon: page.icon,
      iconAssetId: page.iconAssetId,
      coverAssetId: page.coverAssetId,
      revision: page.revision,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      deletedAt: page.deletedAt,
    }));

  const hostPage = collection.hostPageId
    ? (() => {
        const page = pageById.get(collection.hostPageId);
        return page
          ? {
              id: page.id,
              parentId: page.parentId,
              sortKey: page.sortKey,
              title: page.title,
              icon: page.icon,
              iconAssetId: page.iconAssetId,
              coverAssetId: page.coverAssetId,
              coverFocalX: page.coverFocalX,
              coverFocalY: page.coverFocalY,
              coverScale: page.coverScale,
              previewText: extractContentPreview(page.contentJson),
            }
          : null;
      })()
    : null;

  return { collection, hostPage, items: ordered, availablePages, schema: parsedSchema, views: collection.viewsJson };
}
