"use client";

import Image from 'next/image';
import Link from 'next/link';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type CollectionPropertyType = 'text' | 'number' | 'select' | 'multi-select' | 'checkbox' | 'date' | 'url';

type CollectionProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options?: string[];
};

type CollectionSchema = {
  properties: CollectionProperty[];
};

type CollectionRecord = {
  id: string;
  name: string;
  hostPageId: string | null;
  schemaJson: string;
  viewsJson: string;
};

type PageForSelector = {
  id: string;
  title: string;
  icon: string | null;
  coverAssetId: string | null;
};

type CollectionItem = {
  collectionId: string;
  pageId: string;
  propertiesJson: string;
  sortKey: number;
  page: {
    id: string;
    title: string;
    icon: string | null;
    coverAssetId: string | null;
    contentJson: string;
  };
};

type ViewMode = 'table' | 'gallery';

type SortDirection = 'asc' | 'desc';

type CollectionViews = {
  mode: ViewMode;
  sort?: {
    propertyId: string;
    direction: SortDirection;
  };
  filter?: {
    propertyId: string;
    query: string;
  };
};

type ResponsePayload = {
  collection: CollectionRecord;
  items: CollectionItem[];
  availablePages: Array<
    PageForSelector & {
      parentId: string | null;
      sortKey: number;
      revision: number;
      contentJson: string;
      createdAt: number;
      updatedAt: number;
      deletedAt: number | null;
    }
  >;
};

const PROPERTY_TYPES: Array<{ value: CollectionPropertyType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi-select', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
];

function parseSchema(value: string): CollectionSchema {
  try {
    const parsed = JSON.parse(value) as { properties?: unknown };
    if (Array.isArray(parsed?.properties)) {
      return {
        properties: parsed.properties
          .map((property) => {
            if (!property || typeof property !== 'object') {
              return null;
            }
            const raw = property as {
              id?: unknown;
              name?: unknown;
              type?: unknown;
              options?: unknown;
            };
            if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
              return null;
            }
            const type =
              raw.type === 'text' ||
              raw.type === 'number' ||
              raw.type === 'select' ||
              raw.type === 'multi-select' ||
              raw.type === 'checkbox' ||
              raw.type === 'date' ||
              raw.type === 'url'
                ? (raw.type as CollectionPropertyType)
                : 'text';
            return {
              id: raw.id,
              name: raw.name || 'Property',
              type,
              options: type === 'select' || type === 'multi-select' ?
                Array.from(
                  new Set(
                    Array.isArray(raw.options)
                      ? raw.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
                      : [],
                  ),
                )
                : undefined,
            } as CollectionProperty;
          })
          .filter(Boolean) as CollectionProperty[],
      };
    }
  } catch {
    // ignore parse error
  }
  return { properties: [] };
}

function parseViews(value: string): CollectionViews {
  try {
    const parsed = JSON.parse(value) as CollectionViews;
    if (parsed && typeof parsed === 'object') {
      return {
        mode: parsed.mode === 'gallery' ? 'gallery' : 'table',
        sort:
          parsed.sort &&
          typeof parsed.sort.propertyId === 'string' &&
          (parsed.sort.direction === 'asc' || parsed.sort.direction === 'desc')
            ? {
                propertyId: parsed.sort.propertyId,
                direction: parsed.sort.direction,
              }
            : undefined,
        filter:
          parsed.filter && typeof parsed.filter.propertyId === 'string' && typeof parsed.filter.query === 'string'
            ? {
                propertyId: parsed.filter.propertyId,
                query: parsed.filter.query,
              }
            : undefined,
      };
    }
  } catch {
    // ignore parse error
  }
  return { mode: 'table' };
}

function parseProperties(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failure
  }
  return {};
}

function stringifyProperties(values: Record<string, unknown>): string {
  return JSON.stringify(values);
}

function normalizeUrl(value: string): string {
  return value.trim();
}

function normalizeDate(value: string): string {
  return value;
}

function normalizeList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toInputValue(type: CollectionPropertyType, value: unknown): string {
  if (type === 'checkbox') {
    return Boolean(value) ? 'true' : 'false';
  }
  if (type === 'multi-select' && Array.isArray(value)) {
    return value.join(', ');
  }
  return value == null ? '' : String(value);
}

function parseInputValue(type: CollectionPropertyType, raw: string): unknown {
  if (type === 'checkbox') {
    return raw === 'true';
  }
  if (type === 'number') {
    if (!raw.trim()) {
      return '';
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type === 'date') {
    return normalizeDate(raw);
  }
  if (type === 'multi-select') {
    return normalizeList(raw);
  }
  if (type === 'url') {
    return normalizeUrl(raw);
  }
  return raw;
}

function compareValues(type: CollectionPropertyType | 'title', aRaw: unknown, bRaw: unknown, direction: SortDirection): number {
  const order = direction === 'desc' ? -1 : 1;

  if (type === 'number') {
    const aNumber = typeof aRaw === 'number' ? aRaw : Number(aRaw);
    const bNumber = typeof bRaw === 'number' ? bRaw : Number(bRaw);
    const aValue = Number.isFinite(aNumber) ? aNumber : Number.NaN;
    const bValue = Number.isFinite(bNumber) ? bNumber : Number.NaN;

    if (Number.isNaN(aValue) && Number.isNaN(bValue)) {
      return 0;
    }
    if (Number.isNaN(aValue)) {
      return 1;
    }
    if (Number.isNaN(bValue)) {
      return -1;
    }
    return (aValue - bValue) * order;
  }

  if (type === 'checkbox') {
    const aValue = Boolean(aRaw);
    const bValue = Boolean(bRaw);
    if (aValue === bValue) {
      return 0;
    }
    return (aValue ? 1 : -1) * order;
  }

  if (type === 'date') {
    const aDate = Date.parse(String(aRaw || ''));
    const bDate = Date.parse(String(bRaw || ''));

    if (Number.isNaN(aDate) && Number.isNaN(bDate)) {
      return 0;
    }
    if (Number.isNaN(aDate)) {
      return 1;
    }
    if (Number.isNaN(bDate)) {
      return -1;
    }
    return (aDate - bDate) * order;
  }

  const aText = String(aRaw || '').toLowerCase();
  const bText = String(bRaw || '').toLowerCase();
  return aText.localeCompare(bText) * order;
}

function getFirstImageUrl(page: { coverAssetId: string | null; contentJson: string }): string | null {
  if (page.coverAssetId) {
    return `/api/assets/${page.coverAssetId}`;
  }

  if (!page.contentJson) {
    return null;
  }

  try {
    const content = JSON.parse(page.contentJson) as unknown;
    const walk = (node: unknown): string | null => {
      if (!node || typeof node !== 'object') {
        return null;
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          const found = walk(child);
          if (found) {
            return found;
          }
        }
      } else {
        const record = node as {
          type?: unknown;
          props?: { url?: unknown; fileUrl?: unknown; source?: unknown };
          children?: unknown;
          content?: unknown;
        };

        if (record.type === 'image') {
          const candidate =
            (typeof record.props?.url === 'string' ? record.props.url : undefined) ||
            (typeof record.props?.fileUrl === 'string' ? record.props.fileUrl : undefined) ||
            (typeof record.props?.source === 'string' ? record.props.source : undefined);
          if (candidate) {
            return candidate;
          }
        }

        if (record.children !== undefined) {
          const fromChildren = walk(record.children);
          if (fromChildren) {
            return fromChildren;
          }
        }

        if (record.content !== undefined) {
          const fromContent = walk(record.content);
          if (fromContent) {
            return fromContent;
          }
        }
      }

      return null;
    };

    return walk(content) || null;
  } catch {
    return null;
  }
}

function filterItems(items: CollectionItem[], propertyId: string, query: string): CollectionItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!propertyId || !trimmed) {
    return items;
  }

  return items.filter((item) => {
    const values = parseProperties(item.propertiesJson);
    const value = values[propertyId];

    if (Array.isArray(value)) {
      return value
        .map(String)
        .join(',')
        .toLowerCase()
        .includes(trimmed);
    }

    return String(value || '').toLowerCase().includes(trimmed);
  });
}

function sortItems(items: CollectionItem[], schema: CollectionSchema, sortBy: string, direction: SortDirection): CollectionItem[] {
  const copy = [...items];

  if (!sortBy || sortBy === 'sortKey') {
    copy.sort((a, b) => (direction === 'asc' ? a.sortKey - b.sortKey : b.sortKey - a.sortKey));
    return copy;
  }

  const property = schema.properties.find((entry) => entry.id === sortBy);

  copy.sort((a, b) => {
    if (sortBy === 'title') {
      const byTitle = (a.page.title || '').localeCompare(b.page.title);
      return direction === 'asc' ? byTitle : -byTitle;
    }

    if (!property) {
      return direction === 'asc' ? a.sortKey - b.sortKey : b.sortKey - a.sortKey;
    }

    const aRaw = parseProperties(a.propertiesJson)[property.id];
    const bRaw = parseProperties(b.propertiesJson)[property.id];

    return compareValues(property.type, aRaw, bRaw, direction);
  });

  return copy;
}

function renderPropertyControl(
  property: CollectionProperty,
  value: unknown,
  onChange: (next: unknown) => void,
  disabled: boolean,
): ReactNode {
  if (property.type === 'checkbox') {
    return (
      <label className="collection-row-checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.checked);
          }}
          disabled={disabled}
        />
      </label>
    );
  }

  if (property.type === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(event.target.value);
        }}
        disabled={disabled || !property.options?.length}
      >
        <option value="">Choose…</option>
        {(property.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === 'date') {
    return (
      <input
        type="date"
        value={toInputValue(property.type, value)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(parseInputValue(property.type, event.target.value));
        }}
        disabled={disabled}
      />
    );
  }

  return (
    <input
      type={property.type === 'number' ? 'number' : property.type === 'url' ? 'url' : 'text'}
      value={toInputValue(property.type, value)}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onChange(parseInputValue(property.type, event.target.value));
      }}
      placeholder={property.type === 'number' ? '0' : property.name}
      disabled={disabled}
    />
  );
}

function renderGalleryProperty(property: CollectionProperty, value: unknown): ReactNode {
  const text =
    property.type === 'multi-select' && Array.isArray(value)
      ? value.join(', ')
      : property.type === 'checkbox'
        ? value
          ? 'Yes'
          : 'No'
        : normalizeUrl(String(value || ''));

  return (
    <p className="help gallery-property">
      <strong>{property.name}:</strong> {text || '—'}
    </p>
  );
}

export function CollectionEditor({ collectionId }: { collectionId: string }) {
  const [collection, setCollection] = useState<CollectionRecord | null>(null);
  const [schema, setSchema] = useState<CollectionSchema>({ properties: [] });
  const [views, setViews] = useState<CollectionViews>({ mode: 'table' });
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [availablePages, setAvailablePages] = useState<PageForSelector[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState('');
  const viewSaveTimerRef = useRef<number | null>(null);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<CollectionPropertyType>('text');
  const [newPropertyOptions, setNewPropertyOptions] = useState('');

  const [newPageTitle, setNewPageTitle] = useState('');
  const [existingPageId, setExistingPageId] = useState('');

  const [filterBy, setFilterBy] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortBy, setSortBy] = useState('sortKey');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const loadCollection = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/collections/${collectionId}`);
      if (!response.ok) {
        setStatus('Unable to load collection');
        return;
      }

      const payload = (await response.json()) as ResponsePayload & { schema: CollectionSchema };
      const parsedSchema = parseSchema(payload.collection.schemaJson);
      const parsedViews = parseViews(payload.collection.viewsJson);

      setCollection(payload.collection);
      setSchema(parsedSchema);
      setViews(parsedViews);
      setItems(payload.items);
      setAvailablePages(payload.availablePages);
      setSortBy(parsedViews.sort?.propertyId ?? 'sortKey');
      setSortDirection(parsedViews.sort?.direction ?? 'asc');
      setFilterBy(parsedViews.filter?.propertyId ?? '');
      setFilterQuery(parsedViews.filter?.query ?? '');
      setStatus('');
    } catch {
      setStatus('Unable to load collection');
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  const setStatusTemporarily = useCallback((message: string) => {
    setStatus(message);
    if (!message) {
      return;
    }
    setTimeout(() => {
      setStatus((current) => (current === message ? '' : current));
    }, 2000);
  }, []);

  const saveSchema = useCallback(
    async (nextSchema: CollectionSchema) => {
      if (!collection) {
        return;
      }
      try {
        const response = await fetch(`/api/collections/${collection.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: collection.id, schema: nextSchema }),
        });
        if (!response.ok) {
          throw new Error('Save failed');
        }
        setSchema(nextSchema);
        await loadCollection();
      } catch {
        setStatusTemporarily('Could not save property schema');
      }
    },
    [collection, loadCollection, setStatusTemporarily],
  );

  const saveViews = useCallback(
    async (nextViews: CollectionViews) => {
      if (!collection) {
        return;
      }

      const response = await fetch(`/api/collections/${collection.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: collection.id, views: nextViews }),
      });
      if (!response.ok) {
        setStatusTemporarily('Could not save view settings');
        return;
      }
    },
    [collection, setStatusTemporarily],
  );

  useEffect(() => {
    if (!collection || isLoading) {
      return;
    }
    if (viewSaveTimerRef.current !== null) {
      clearTimeout(viewSaveTimerRef.current);
    }
    viewSaveTimerRef.current = window.setTimeout(() => {
      viewSaveTimerRef.current = null;
      void saveViews({
        ...views,
        sort: sortBy === 'sortKey' ? undefined : { propertyId: sortBy, direction: sortDirection },
        filter: filterBy ? { propertyId: filterBy, query: filterQuery } : undefined,
      });
    }, 350);

    return () => {
      if (viewSaveTimerRef.current !== null) {
        clearTimeout(viewSaveTimerRef.current);
        viewSaveTimerRef.current = null;
      }
    };
  }, [collection, filterBy, filterQuery, isLoading, saveViews, sortBy, sortDirection, views]);

  const addProperty = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection) {
      return;
    }

    const name = newPropertyName.trim();
    if (!name) {
      return;
    }

    const options =
      newPropertyType === 'select' || newPropertyType === 'multi-select'
        ? newPropertyOptions
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : undefined;

    const next: CollectionSchema = {
      properties: [
        ...schema.properties,
        {
          id: `property-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          name,
          type: newPropertyType,
          ...(options && options.length > 0 ? { options } : {}),
        },
      ],
    };

    setSchema(next);
    await saveSchema(next);
    setNewPropertyName('');
    setNewPropertyOptions('');
    setNewPropertyType('text');
    setStatusTemporarily('Property added');
  };

  const reorderProperty = async (propertyId: string, direction: 'up' | 'down') => {
    const index = schema.properties.findIndex((entry) => entry.id === propertyId);
    if (index < 0) {
      return;
    }

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= schema.properties.length) {
      return;
    }

    const nextProperties = [...schema.properties];
    [nextProperties[index], nextProperties[target]] = [nextProperties[target], nextProperties[index]];
    await saveSchema({ ...schema, properties: nextProperties });
  };

  const removeProperty = async (propertyId: string) => {
    const property = schema.properties.find((entry) => entry.id === propertyId);
    if (!window.confirm(`Remove “${property?.name || 'this property'}” from the collection? Existing values will be hidden from the collection view.`)) {
      return;
    }
    const next = {
      ...schema,
      properties: schema.properties.filter((entry) => entry.id !== propertyId),
    };

    await saveSchema(next);
    setStatusTemporarily('Property removed');
  };

  const persistItemOrder = useCallback(
    async (rows: CollectionItem[]) => {
      if (!collection) {
        return;
      }
      const moves = rows.map((item, index) => ({ pageId: item.pageId, sortKey: index + 1 }));
      const response = await fetch(`/api/collections/${collection.id}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', moves }),
      });
      if (!response.ok) {
        setStatusTemporarily('Could not reorder items');
      }
    },
    [collection, setStatusTemporarily],
  );

  const reorderEntry = async (pageId: string, direction: 'up' | 'down') => {
    const sorted = [...items].sort((a, b) => a.sortKey - b.sortKey);
    const index = sorted.findIndex((item) => item.pageId === pageId);
    if (index < 0) {
      return;
    }

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= sorted.length) {
      return;
    }

    const copy = [...sorted];
    [copy[index], copy[target]] = [copy[target], copy[index]];

    const next = copy.map((item, index) => ({
      ...item,
      sortKey: index + 1,
    }));

    setItems(next);
    await persistItemOrder(next);
  };

  const deleteCollection = async () => {
    if (!collection) {
      return;
    }
    if (!window.confirm('Delete this collection?')) {
      return;
    }

    const response = await fetch(`/api/collections/${collection.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setStatusTemporarily('Unable to delete collection');
      return;
    }

    window.location.href = '/collections';
  };

  const setCollectionName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const nextName = String(form.get('name') ?? '').trim();
    if (!nextName || nextName === collection.name) {
      return;
    }

    const response = await fetch(`/api/collections/${collection.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: collection.id, name: nextName }),
    });

    if (!response.ok) {
      setStatusTemporarily('Unable to rename collection');
      return;
    }

    await loadCollection();
    setStatusTemporarily('Collection renamed');
  };

  const addExistingEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection || !existingPageId) {
      return;
    }

    const response = await fetch(`/api/collections/${collection.id}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: existingPageId, properties: {} }),
    });

    if (!response.ok) {
      setStatusTemporarily('Could not add entry');
      return;
    }

    setExistingPageId('');
    await loadCollection();
    setStatusTemporarily('Entry added');
  };

  const addNewEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection) {
      return;
    }

    const title = newPageTitle.trim() || 'Untitled';

    const pageResponse = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!pageResponse.ok) {
      setStatusTemporarily('Could not create page');
      return;
    }
    const pagePayload = (await pageResponse.json()) as { page: { id: string } };

    const addResponse = await fetch(`/api/collections/${collection.id}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: pagePayload.page.id, properties: {} }),
    });

    if (!addResponse.ok) {
      setStatusTemporarily('Could not create entry');
      return;
    }

    setNewPageTitle('');
    await loadCollection();
    setStatusTemporarily('Page and entry created');
  };

  const removeEntry = async (pageId: string) => {
    if (!collection) {
      return;
    }
    const entry = items.find((item) => item.pageId === pageId);
    if (!window.confirm(`Remove “${entry?.page.title || 'this page'}” from the collection? The page itself will remain in the workspace.`)) {
      return;
    }

    const response = await fetch(`/api/collections/${collection.id}/items`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId }),
    });

    if (!response.ok) {
      setStatusTemporarily('Could not remove entry');
      return;
    }

    await loadCollection();
    setStatusTemporarily('Entry removed');
  };

  const updateEntryProperty = async (pageId: string, propertyId: string, nextValue: unknown) => {
    if (!collection) {
      return;
    }

    const current = items.find((item) => item.pageId === pageId);
    const parsed = parseProperties(current?.propertiesJson ?? '{}');
    parsed[propertyId] = nextValue;
    const nextProperties = stringifyProperties(parsed);

    const response = await fetch(`/api/collections/${collection.id}/items`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId, properties: { [propertyId]: nextValue } }),
    });

    if (!response.ok) {
      setStatusTemporarily('Could not update property');
      setItems((previous) => [...previous]);
      await loadCollection();
      return;
    }

    setItems((previous) =>
      previous.map((item) =>
        item.pageId === pageId
          ? {
              ...item,
              propertiesJson: nextProperties,
            }
          : item,
      ),
    );
  };

  const filtered = useMemo(() => filterItems(items, filterBy, filterQuery), [items, filterBy, filterQuery]);
  const ordered = useMemo(() => sortItems(filtered, schema, sortBy, sortDirection), [filtered, schema, sortBy, sortDirection]);

  if (!collection) {
    return isLoading ? (
      <div className="editor-shell help" role="status">Loading collection…</div>
    ) : (
      <section className="editor-shell recovery-notice error" role="alert">
        <strong>{status || 'Collection not found'}</strong>
        <button type="button" onClick={() => void loadCollection()}>Retry loading collection</button>
      </section>
    );
  }

  return (
    <div className="editor-shell collection-workspace">
      <div className="collection-toolbar">
        <section className="collection-toolbar-card">
          <form onSubmit={setCollectionName} className="collection-name-form">
            <input
              name="name"
              defaultValue={collection.name}
              aria-label="Collection name"
              placeholder="Collection name"
            />
            <button type="submit">Rename</button>
          </form>

          <div className="toolbar">
            <button type="button" onClick={() => {
              const next: ViewMode = views.mode === 'table' ? 'gallery' : 'table';
              setViews((current) => ({ ...current, mode: next }));
            }}>
              View: {views.mode === 'table' ? 'Table' : 'Gallery'}
            </button>
            <button type="button" onClick={deleteCollection} className="danger-btn">
              Delete collection
            </button>
          </div>
        </section>

        <section className="collection-controls collection-toolbar-card">
          <label htmlFor="view-sort-by">Sort</label>
          <select
            id="view-sort-by"
            value={sortBy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSortBy(event.target.value);
            }}
          >
            <option value="sortKey">Default order</option>
            <option value="title">Page title</option>
            {schema.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>

          <select
            value={sortDirection}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSortDirection(event.target.value as SortDirection);
            }}
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>

          <label htmlFor="filter-property">Filter</label>
          <select
            id="filter-property"
            value={filterBy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setFilterBy(event.target.value);
            }}
          >
            <option value="">None</option>
            {schema.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Filter query"
            value={filterQuery}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setFilterQuery(event.target.value);
            }}
          />
        </section>
      </div>

      <section className="collection-properties collection-toolbar-card">
        <h3>Properties</h3>
        {schema.properties.length ? (
          <ul className="collection-property-list">
            {schema.properties.map((property, index) => (
              <li key={property.id} className="collection-property-item">
                <span>{property.name}</span>
                <span className="help">{property.type}</span>
                <div className="toolbar">
                  <button type="button" className="mini-btn" onClick={() => reorderProperty(property.id, 'up')} disabled={index === 0}>
                    Up
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => reorderProperty(property.id, 'down')}
                    disabled={index === schema.properties.length - 1}
                  >
                    Down
                  </button>
                  <button type="button" className="mini-btn danger-btn" onClick={() => removeProperty(property.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">No properties yet. Add one so entries can track values.</p>
        )}

        <form onSubmit={addProperty} className="properties-form">
          <input
            value={newPropertyName}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPropertyName(event.target.value)}
            placeholder="Property name"
          />
          <select
            value={newPropertyType}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setNewPropertyType(event.target.value as CollectionPropertyType)
            }
          >
            {PROPERTY_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {(newPropertyType === 'select' || newPropertyType === 'multi-select') && (
            <input
              value={newPropertyOptions}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPropertyOptions(event.target.value)}
              placeholder="Options (comma-separated)"
            />
          )}
          <button type="submit">Add property</button>
        </form>
      </section>

      <section className="collection-properties collection-toolbar-card">
        <h3>Entries</h3>
        <div className="toolbar">
          <form onSubmit={addExistingEntry} className="entry-add-form">
            <select
              value={existingPageId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setExistingPageId(event.target.value)}
            >
              <option value="">Add existing page</option>
              {availablePages
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
                .map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title}
                  </option>
                ))}
            </select>
            <button type="submit" disabled={!existingPageId}>
              Add
            </button>
          </form>

          <form onSubmit={addNewEntry} className="entry-add-form">
            <input
              value={newPageTitle}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPageTitle(event.target.value)}
              placeholder="New page title"
            />
            <button type="submit">Create new page entry</button>
          </form>
        </div>
      </section>

      {status ? <p className="status-note">{status}</p> : null}

      {isLoading ? (
        <p className="help">Loading entries…</p>
      ) : items.length === 0 ? (
        <p className="help">No entries yet. Add an existing page or create a new page entry above.</p>
      ) : ordered.length === 0 ? (
        <div className="no-results-state">
          <p className="help">No entries match your current filter.</p>
          <button type="button" onClick={() => {
            setFilterBy('');
            setFilterQuery('');
          }}>
            Clear filter
          </button>
        </div>
      ) : views.mode === 'gallery' ? (
        <section className="collection-gallery">
          {ordered.map((item) => {
            const image = getFirstImageUrl(item.page);
            return (
              <article key={item.pageId} className="collection-card collection-gallery-item">
                <Link href={`/page/${item.pageId}`} className="collection-cover-link" style={{ gridArea: 'cover' }}>
                  {image ? (
                    <Image
                      src={image}
                      alt={`Cover for ${item.page.title}`}
                      className="collection-cover"
                      width={640}
                      height={360}
                      unoptimized
                    />
                  ) : (
                    <div className="collection-cover-blank">No image</div>
                  )}
                </Link>
                <div className="collection-card-body">
                  <Link href={`/page/${item.pageId}`} className="text-link collection-page-title">
                    {item.page.icon ? <span>{item.page.icon} </span> : null}
                    {item.page.title || 'Untitled'}
                  </Link>

                  {schema.properties.length ? (
                    <div className="collection-properties-grid">
                      {schema.properties.map((property) => {
                        const values = parseProperties(item.propertiesJson);
                        return (
                          <div key={property.id}>
                            {renderGalleryProperty(property, values[property.id])}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="help">No properties configured.</p>
                  )}

                  <div className="toolbar">
                    <button type="button" onClick={() => void reorderEntry(item.pageId, 'up')} className="mini-btn">
                      Move up
                    </button>
                    <button type="button" onClick={() => void reorderEntry(item.pageId, 'down')} className="mini-btn">
                      Move down
                    </button>
                    <button type="button" onClick={() => void removeEntry(item.pageId)} className="mini-btn danger-btn">
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="collection-table-wrap">
          <table className="collection-table">
            <thead>
              <tr>
                <th>Page</th>
                {schema.properties.map((property) => (
                  <th key={property.id}>{property.name}</th>
                ))}
                <th>Reorder</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((item) => {
                const properties = parseProperties(item.propertiesJson);
                return (
                  <tr key={item.pageId}>
                    <td>
                      <Link href={`/page/${item.pageId}`} className="text-link">
                        {item.page.icon ? <span>{item.page.icon} </span> : null}
                        {item.page.title || 'Untitled'}
                      </Link>
                    </td>
                    {schema.properties.map((property) => (
                      <td key={property.id}>
                        {renderPropertyControl(property, properties[property.id], (nextValue) => {
                          void updateEntryProperty(item.pageId, property.id, nextValue);
                        }, false)}
                      </td>
                    ))}
                    <td>
                      <div className="toolbar">
                        <button type="button" className="mini-btn" onClick={() => void reorderEntry(item.pageId, 'up')}>
                          Up
                        </button>
                        <button type="button" className="mini-btn" onClick={() => void reorderEntry(item.pageId, 'down')}>
                          Down
                        </button>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="mini-btn danger-btn" onClick={() => void removeEntry(item.pageId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
