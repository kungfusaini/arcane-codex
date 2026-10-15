import { getCollection, getPublishedCollectionSnapshot, listCollectionItems, listPages, listPublishedPages } from './storage';
import type { CollectionOptionColor, CollectionPropertyType, CollectionSchema } from './types';
import { plainTextFromMarkdown } from '../documents/markdown';

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
  properties: Record<string, unknown>;
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
    kind: import('./types').PageKind;
    summary: string;
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
  views: import('./types').CollectionViews;
};

export type CollectionPayloadOptions = {
  sortBy?: string;
  direction?: 'asc' | 'desc';
  filterBy?: string | null;
  filterQuery?: string;
  published?: boolean;
};

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
  const aProps = a.properties;
  const bProps = b.properties;
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

function extractContentPreview(bodyMarkdown: string): string {
  return plainTextFromMarkdown(bodyMarkdown).slice(0, 400);
}

function applyFilter(items: CollectionPayloadItem[], propertyId: string | null | undefined, query: string): CollectionPayloadItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!propertyId || !trimmed) return items;

  return items.filter((item) => {
    const raw = item.properties[propertyId];
    if (Array.isArray(raw)) return raw.join(',').toLowerCase().includes(trimmed);
    return normalizeText(raw).toLowerCase().includes(trimmed);
  });
}

export function getCollectionDetailPayload(collectionId: string, options: CollectionPayloadOptions = {}): CollectionDetailPayload | null {
  const publishedSnapshot = options.published ? getPublishedCollectionSnapshot(collectionId) : null;
  const collection = publishedSnapshot?.collection ?? (options.published ? null : getCollection(collectionId));
  if (!collection) return null;

  const sortBy = options.sortBy || 'sortKey';
  const direction = options.direction === 'desc' ? 'desc' : 'asc';
  const filterQuery = options.filterQuery || '';
  const parsedSchema = collection.schema;

  const allPages = options.published ? listPublishedPages(false) : listPages();
  const pageById = new Map(allPages.map((page) => [page.id, page]));
  const items = (publishedSnapshot?.items ?? listCollectionItems(collectionId))
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
          firstImageUrl: page.coverAssetId ? `/api/assets/${page.coverAssetId}` : null,
          kind: page.kind,
          summary: page.summary,
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

  const hostPage = collection.embedPageId
    ? (() => {
        const page = pageById.get(collection.embedPageId);
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
              previewText: extractContentPreview(page.bodyMarkdown),
            }
          : null;
      })()
    : null;

  return { collection, hostPage, items: ordered, availablePages, schema: parsedSchema, views: collection.view };
}
