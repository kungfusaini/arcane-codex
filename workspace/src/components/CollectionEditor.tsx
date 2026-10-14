"use client";

import Image from 'next/image';
import Link from 'next/link';
import { PageIcon } from '@/components/PageIcon';
import { PublishMediaTrigger } from '@/components/PublishMediaModal';
import { useDismissibleDetails } from '@/components/useDismissibleDetails';
import type { PageUrlPage } from '@/lib/pageUrls';
import { buildWorkspacePagePathFromPages } from '@/lib/workspaceHome';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type CollectionPropertyType = 'text' | 'number' | 'select' | 'multi-select' | 'checkbox' | 'date' | 'url';

type OptionColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type CollectionProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options?: string[];
  optionColors?: Record<string, OptionColor>;
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
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
  coverAssetId: string | null;
};

type HostPage = PageForSelector & {
  coverFocalX: number;
  coverFocalY: number;
  coverScale: number;
  previewText: string;
};

type CollectionItem = {
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
  };
};

type ViewMode = 'table' | 'gallery';

type SortDirection = 'asc' | 'desc';

const MAX_COLLECTION_STAGGER_INDEX = 6;

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
  hostPage: HostPage | null;
  items: CollectionItem[];
  availablePages: Array<
    PageForSelector & {
      parentId: string | null;
      sortKey: number;
      revision: number;
      createdAt: number;
      updatedAt: number;
      deletedAt: number | null;
    }
  >;
  schema?: CollectionSchema;
  views?: string;
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

const PROPERTY_ICONS: Record<CollectionPropertyType, string> = {
  text: 'Aa',
  number: '#',
  select: '⌄',
  'multi-select': '≡',
  checkbox: '☑',
  date: '◷',
  url: '↗',
};

const OPTION_COLORS: Array<{ value: OptionColor; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'accent', label: 'Blue' },
  { value: 'success', label: 'Green' },
  { value: 'warning', label: 'Yellow' },
  { value: 'danger', label: 'Red' },
];

function isOptionColor(value: unknown): value is OptionColor {
  return value === 'default' || value === 'accent' || value === 'success' || value === 'warning' || value === 'danger';
}

function normalizeOptionColors(raw: unknown, options: string[]): Record<string, OptionColor> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const optionSet = new Set(options);
  const colors = Object.entries(raw as Record<string, unknown>).reduce<Record<string, OptionColor>>((next, [option, color]) => {
    if (optionSet.has(option) && isOptionColor(color) && color !== 'default') {
      next[option] = color;
    }
    return next;
  }, {});

  return Object.keys(colors).length ? colors : undefined;
}

function getOptionColor(property: CollectionProperty, option: string): OptionColor {
  return property.optionColors?.[option] ?? 'default';
}

const BOOKS_COLLECTION_SCHEMA: CollectionSchema = {
  properties: [
    { id: 'author', name: 'Author', type: 'select' },
    { id: 'status', name: 'Status', type: 'select', options: ['To read', 'Reading', 'Finished'] },
    { id: 'type', name: 'Type', type: 'multi-select' },
    { id: 'score', name: 'Score /5', type: 'number' },
    { id: 'tags', name: 'Tags', type: 'multi-select' },
  ],
};

function isBooksCollectionName(name: string): boolean {
  return name.toLowerCase().includes('book');
}

function slugifyPropertyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
}

function getPropertyTone(property: CollectionProperty): string {
  const name = property.name.toLowerCase();
  if (name.includes('status')) return 'status';
  if (name.includes('type') || name.includes('genre')) return 'warm';
  if (name.includes('tag')) return 'tag';
  if (name.includes('score') || name.includes('rating')) return 'score';
  return 'accent';
}

function isScoreProperty(property: CollectionProperty): boolean {
  const name = property.name.toLowerCase();
  return property.type === 'number' && (name.includes('score') || name.includes('rating') || name.includes('/5'));
}

function getDisplayPropertyName(property: CollectionProperty, isBooksCollection: boolean): string {
  if (isBooksCollection && isScoreProperty(property)) {
    return 'Score /5';
  }
  return property.name;
}

function formatScoreStars(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '—';
  }
  const filled = Math.max(0, Math.min(5, Math.round(numeric)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
}

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
              optionColors?: unknown;
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
            const options = type === 'select' || type === 'multi-select' ?
              Array.from(
                new Set(
                  Array.isArray(raw.options)
                    ? raw.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
                    : [],
                ),
              )
              : undefined;

            return {
              id: raw.id,
              name: raw.name || 'Property',
              type,
              options,
              optionColors: options ? normalizeOptionColors(raw.optionColors, options) : undefined,
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

function getFirstImageUrl(page: { coverAssetId: string | null; firstImageUrl: string | null }): string | null {
  return page.firstImageUrl ?? (page.coverAssetId ? `/api/assets/${page.coverAssetId}` : null);
}

function getCollectionCoverStyle(page: CollectionItem['page']): CSSProperties | undefined {
  if (!page.coverAssetId) return undefined;
  return {
    objectPosition: `${page.coverFocalX}% ${page.coverFocalY}%`,
    transform: `scale(${page.coverScale / 100})`,
  };
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

function CollectionPropertyControl({
  property,
  value,
  onCommit,
  onEnsureOptions,
  disabled,
}: {
  property: CollectionProperty;
  value: unknown;
  onCommit: (next: unknown) => void;
  onEnsureOptions?: (values: string[]) => void;
  disabled: boolean;
}) {
  const persistedValue = toInputValue(property.type, value);
  const [draft, setDraft] = useState(persistedValue);
  const optionListId = `collection-options-${property.id}`;

  useEffect(() => {
    setDraft(persistedValue);
  }, [persistedValue]);

  const commitDraft = (raw: string) => {
    const next = parseInputValue(property.type, raw);
    if (property.type === 'select') {
      const option = typeof next === 'string' ? next.trim() : '';
      if (option) {
        onEnsureOptions?.([option]);
      }
    }
    if (property.type === 'multi-select' && Array.isArray(next)) {
      onEnsureOptions?.(next.map((entry) => String(entry).trim()).filter(Boolean));
    }
    if (JSON.stringify(next) !== JSON.stringify(value)) {
      onCommit(next);
    }
  };

  if (property.type === 'checkbox') {
    return (
      <label className="collection-row-checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onCommit(event.target.checked)}
          disabled={disabled}
        />
      </label>
    );
  }

  if (property.type === 'select' || property.type === 'multi-select' || property.type === 'text' || property.type === 'number' || property.type === 'date' || property.type === 'url') {
    const input = (
      <input
        className={property.type === 'multi-select' ? 'collection-cell-tags' : property.type === 'select' ? 'collection-cell-select' : undefined}
        data-tone={property.type === 'select' ? getPropertyTone(property) : undefined}
        list={property.type === 'select' || property.type === 'multi-select' ? optionListId : undefined}
        type={property.type === 'date' ? 'date' : property.type === 'number' ? 'number' : property.type === 'url' ? 'url' : 'text'}
        value={draft}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={(event) => commitDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.value = persistedValue;
            setDraft(persistedValue);
            event.currentTarget.blur();
          }
        }}
        placeholder={property.type === 'number' ? '0' : property.type === 'select' ? 'Choose or type' : property.name}
        disabled={disabled}
      />
    );

    if (property.type === 'select') {
      const selected = persistedValue.trim();
      return (
        <div className="collection-select-cell">
          {selected ? (
            <span className="collection-select-token" data-color={getOptionColor(property, selected)} aria-hidden="true">{selected}</span>
          ) : (
            <span className="collection-empty-value" aria-hidden="true">Choose or type</span>
          )}
          {input}
          <datalist id={optionListId}>{(property.options ?? []).map((option) => <option key={option} value={option} />)}</datalist>
        </div>
      );
    }

    if (property.type === 'multi-select') {
      const tags = persistedValue.split(',').map((tag) => tag.trim()).filter(Boolean);
      return (
        <div className="collection-multi-select-cell">
          <div className="collection-token-list" aria-hidden="true">
            {tags.length ? tags.map((tag) => <span key={tag} data-color={getOptionColor(property, tag)}>{tag}</span>) : <span className="collection-empty-value">—</span>}
          </div>
          {input}
          <datalist id={optionListId}>{(property.options ?? []).map((option) => <option key={option} value={option} />)}</datalist>
        </div>
      );
    }

    if (isScoreProperty(property)) {
      return (
        <div className="collection-score-cell">
          <span className="collection-score-stars" aria-hidden="true">{formatScoreStars(value)}</span>
          {input}
        </div>
      );
    }

    return input;
  }

  return null;
}

function CollectionPropertySettingsRow({
  property,
  index,
  total,
  onMove,
  onRemove,
  onUpdate,
}: {
  property: CollectionProperty;
  index: number;
  total: number;
  onMove: (propertyId: string, direction: 'up' | 'down') => void;
  onRemove: (propertyId: string) => void;
  onUpdate: (propertyId: string, updates: Partial<CollectionProperty>) => void;
}) {
  const [nameDraft, setNameDraft] = useState(property.name);
  const [typeDraft, setTypeDraft] = useState<CollectionPropertyType>(property.type);
  const [optionsDraft, setOptionsDraft] = useState((property.options ?? []).join(', '));

  useEffect(() => {
    setNameDraft(property.name);
    setTypeDraft(property.type);
    setOptionsDraft((property.options ?? []).join(', '));
  }, [property.name, property.options, property.type]);

  const saveName = () => {
    const nextName = nameDraft.trim();
    if (nextName && nextName !== property.name) {
      onUpdate(property.id, { name: nextName });
    }
  };

  const saveType = (nextType: CollectionPropertyType) => {
    setTypeDraft(nextType);
    onUpdate(property.id, {
      type: nextType,
      options: nextType === 'select' || nextType === 'multi-select' ? property.options ?? [] : undefined,
    });
  };

  const saveOptions = () => {
    const nextOptions = optionsDraft
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (JSON.stringify(nextOptions) !== JSON.stringify(property.options ?? [])) {
      onUpdate(property.id, {
        options: nextOptions,
        optionColors: normalizeOptionColors(property.optionColors, nextOptions),
      });
    }
  };

  const saveOptionColor = (option: string, color: OptionColor) => {
    const nextColors = { ...(property.optionColors ?? {}) };
    if (color === 'default') {
      delete nextColors[option];
    } else {
      nextColors[option] = color;
    }
    onUpdate(property.id, { optionColors: Object.keys(nextColors).length ? nextColors : undefined });
  };

  return (
    <li key={property.id} className="collection-property-item" aria-label={property.name}>
      <label>
        Name
        <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={saveName} />
      </label>
      <label>
        Type
        <select value={typeDraft} onChange={(event) => saveType(event.target.value as CollectionPropertyType)}>
          {PROPERTY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {(typeDraft === 'select' || typeDraft === 'multi-select') ? (
        <div className="collection-options-editor">
          <label>
            Options
            <input value={optionsDraft} onChange={(event) => setOptionsDraft(event.target.value)} onBlur={saveOptions} placeholder="Comma-separated values" />
          </label>
          {(property.options ?? []).length ? (
            <div className="collection-option-colors" aria-label={`${property.name} option colors`}>
              {(property.options ?? []).map((option) => (
                <label key={option}>
                  <span className="collection-select-token" data-color={getOptionColor(property, option)}>{option}</span>
                  <select value={getOptionColor(property, option)} onChange={(event) => saveOptionColor(option, event.target.value as OptionColor)}>
                    {OPTION_COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="toolbar">
        <button type="button" className="mini-btn" onClick={() => onMove(property.id, 'up')} disabled={index === 0}>Move up</button>
        <button type="button" className="mini-btn" onClick={() => onMove(property.id, 'down')} disabled={index === total - 1}>Move down</button>
        <button type="button" className="mini-btn danger-action" onClick={() => onRemove(property.id)}>Remove</button>
      </div>
    </li>
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

function renderFocusedPropertyValue(property: CollectionProperty, value: unknown, surface: 'focus' | 'table' = 'focus'): ReactNode {
  const emptyClassName = surface === 'focus' ? 'collection-focus-empty' : 'collection-empty-value';

  if (property.type === 'multi-select' && Array.isArray(value)) {
    return value.length ? (
      <div className={surface === 'focus' ? 'collection-focus-token-list' : 'collection-token-list'} aria-label={property.name}>
        {value.map((entry) => <span key={String(entry)} data-color={getOptionColor(property, String(entry))}>{String(entry)}</span>)}
      </div>
    ) : <span className={emptyClassName}>—</span>;
  }

  if (property.type === 'select') {
    const selected = String(value ?? '').trim();
    return selected ? <span className="collection-select-token" data-color={getOptionColor(property, selected)}>{selected}</span> : <span className={emptyClassName}>—</span>;
  }

  if (property.type === 'checkbox') {
    return <span className="collection-readonly-checkbox" data-checked={value ? 'true' : 'false'}>{value ? 'Yes' : 'No'}</span>;
  }

  if (isScoreProperty(property)) {
    return <span className="collection-score-stars" aria-hidden="true">{formatScoreStars(value)}</span>;
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return <span className={emptyClassName}>—</span>;
  }

  return property.type === 'url' ? <a href={text} className="text-link collection-readonly-value" target="_blank" rel="noreferrer">{normalizeUrl(text)}</a> : <span className="collection-readonly-value">{text}</span>;
}

function getPayloadState(payload?: ResponsePayload | null) {
  const parsedSchema = payload?.schema ?? (payload ? parseSchema(payload.collection.schemaJson) : { properties: [] });
  const parsedViews = payload ? parseViews(payload.views ?? payload.collection.viewsJson) : { mode: 'table' as const };
  return {
    collection: payload?.collection ?? null,
    schema: parsedSchema,
    views: parsedViews,
    items: payload?.items ?? [],
    availablePages: payload?.availablePages ?? [],
    hostPage: payload?.hostPage ?? null,
    sortBy: parsedViews.sort?.propertyId ?? 'sortKey',
    sortDirection: parsedViews.sort?.direction ?? 'asc',
    filterBy: parsedViews.filter?.propertyId ?? '',
    filterQuery: parsedViews.filter?.query ?? '',
  };
}

export function CollectionEditor({ collectionId, embedded = false, focusPageId, readOnly = false, pageRouteBasePath = '/', initialPayload = null }: { collectionId: string; embedded?: boolean; focusPageId?: string; readOnly?: boolean; pageRouteBasePath?: string; initialPayload?: ResponsePayload | null }) {
  useDismissibleDetails('.add-entry-menu, .row-menu');

  const initialState = useMemo(() => getPayloadState(initialPayload), [initialPayload]);
  const [collection, setCollection] = useState<CollectionRecord | null>(initialState.collection);
  const [schema, setSchema] = useState<CollectionSchema>(initialState.schema);
  const [views, setViews] = useState<CollectionViews>(initialState.views);
  const [items, setItems] = useState<CollectionItem[]>(initialState.items);
  const [availablePages, setAvailablePages] = useState<PageForSelector[]>(initialState.availablePages);
  const [hostPage, setHostPage] = useState<HostPage | null>(initialState.hostPage);
  const [isLoading, setIsLoading] = useState(!initialPayload);
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cellStates, setCellStates] = useState<Record<string, 'saving' | 'error'>>({});
  const viewSaveTimerRef = useRef<number | null>(null);
  const cellRequestVersions = useRef<Record<string, number>>({});
  const reorderRequestVersion = useRef(0);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<CollectionPropertyType>('text');
  const [newPropertyOptions, setNewPropertyOptions] = useState('');

  const [newPageTitle, setNewPageTitle] = useState('');
  const [existingPageId, setExistingPageId] = useState('');

  const [filterBy, setFilterBy] = useState(initialState.filterBy);
  const [filterQuery, setFilterQuery] = useState(initialState.filterQuery);
  const [sortBy, setSortBy] = useState(initialState.sortBy);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialState.sortDirection);

  const loadCollection = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/collections/${collectionId}`);
      if (!response.ok) {
        setStatus('Unable to load collection');
        return;
      }

      const payload = (await response.json()) as ResponsePayload;
      const parsedSchema = payload.schema ?? parseSchema(payload.collection.schemaJson);
      const parsedViews = parseViews(payload.views ?? payload.collection.viewsJson);
      const shouldSeedBooksSchema = isBooksCollectionName(payload.collection.name) && parsedSchema.properties.length === 0;

      if (shouldSeedBooksSchema && !readOnly) {
        void fetch(`/api/collections/${collectionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: collectionId, schema: BOOKS_COLLECTION_SCHEMA }),
        });
      }

      setCollection(payload.collection);
      setSchema(shouldSeedBooksSchema ? BOOKS_COLLECTION_SCHEMA : parsedSchema);
      setViews(parsedViews);
      setItems(payload.items);
      setAvailablePages(payload.availablePages);
      setHostPage(payload.hostPage);
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
  }, [collectionId, readOnly]);

  useEffect(() => {
    if (initialPayload) {
      const nextState = getPayloadState(initialPayload);
      setCollection(nextState.collection);
      setSchema(nextState.schema);
      setViews(nextState.views);
      setItems(nextState.items);
      setAvailablePages(nextState.availablePages);
      setHostPage(nextState.hostPage);
      setSortBy(nextState.sortBy);
      setSortDirection(nextState.sortDirection);
      setFilterBy(nextState.filterBy);
      setFilterQuery(nextState.filterQuery);
      setIsLoading(false);
      setStatus('');
      return;
    }

    void loadCollection();
  }, [initialPayload, loadCollection]);

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

  const updateProperty = useCallback(
    (propertyId: string, updates: Partial<CollectionProperty>) => {
      const nextSchema: CollectionSchema = {
        properties: schema.properties.map((property) => {
          if (property.id !== propertyId) {
            return property;
          }

          const nextType = updates.type ?? property.type;
          const nextName = updates.name ?? property.name;
          const nextOptions =
            nextType === 'select' || nextType === 'multi-select'
              ? updates.options ?? property.options ?? []
              : undefined;
          const normalizedOptions = nextOptions?.map((option) => option.trim()).filter(Boolean);
          const optionColors = normalizedOptions
            ? normalizeOptionColors(updates.optionColors ?? property.optionColors, normalizedOptions)
            : undefined;

          return {
            ...property,
            ...updates,
            name: nextName.trim() || 'Property',
            type: nextType,
            ...(normalizedOptions ? { options: normalizedOptions } : { options: undefined }),
            optionColors,
          };
        }),
      };
      setSchema(nextSchema);
      void saveSchema(nextSchema);
    },
    [saveSchema, schema.properties],
  );

  const ensurePropertyOptions = useCallback(
    (propertyId: string, values: string[]) => {
      const property = schema.properties.find((entry) => entry.id === propertyId);
      if (!property || (property.type !== 'select' && property.type !== 'multi-select')) {
        return;
      }
      const nextOptions = Array.from(new Set([
        ...(property.options ?? []),
        ...values.map((value) => value.trim()).filter(Boolean),
      ]));
      if (JSON.stringify(nextOptions) === JSON.stringify(property.options ?? [])) {
        return;
      }
      void updateProperty(propertyId, { options: nextOptions });
    },
    [schema.properties, updateProperty],
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
    if (readOnly || !collection || isLoading) {
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
  }, [collection, filterBy, filterQuery, isLoading, readOnly, saveViews, sortBy, sortDirection, views]);

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
        return false;
      }
      const moves = rows.map((item, index) => ({ pageId: item.pageId, sortKey: index + 1 }));
      try {
        const response = await fetch(`/api/collections/${collection.id}/items`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'reorder', moves }),
        });
        if (!response.ok) {
          throw new Error('Reorder failed');
        }
        return true;
      } catch {
        setStatusTemporarily('Could not reorder items');
        return false;
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

    const requestVersion = reorderRequestVersion.current + 1;
    reorderRequestVersion.current = requestVersion;
    setItems(next);
    const saved = await persistItemOrder(next);
    if (!saved && reorderRequestVersion.current === requestVersion) {
      setItems(sorted);
    }
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

    const definition = schema.properties.find((property) => property.id === propertyId);
    if (definition?.type === 'select' && typeof nextValue === 'string') {
      ensurePropertyOptions(propertyId, [nextValue]);
    }
    if (definition?.type === 'multi-select' && Array.isArray(nextValue)) {
      ensurePropertyOptions(propertyId, nextValue.map((entry) => String(entry)));
    }

    const current = items.find((item) => item.pageId === pageId);
    const previousProperties = current?.propertiesJson ?? '{}';
    const parsed = parseProperties(previousProperties);
    const hadPreviousValue = Object.hasOwn(parsed, propertyId);
    const previousValue = parsed[propertyId];
    parsed[propertyId] = nextValue;
    const nextProperties = stringifyProperties(parsed);
    const cellKey = `${pageId}:${propertyId}`;
    const requestVersion = (cellRequestVersions.current[cellKey] ?? 0) + 1;
    cellRequestVersions.current[cellKey] = requestVersion;

    setCellStates((previous) => ({ ...previous, [cellKey]: 'saving' }));
    setItems((previous) => previous.map((item) => item.pageId === pageId ? { ...item, propertiesJson: nextProperties } : item));

    try {
      const response = await fetch(`/api/collections/${collection.id}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, properties: { [propertyId]: nextValue } }),
      });

      if (!response.ok) {
        throw new Error('Property update failed');
      }
      if (cellRequestVersions.current[cellKey] === requestVersion) {
        setCellStates((previous) => {
          const next = { ...previous };
          delete next[cellKey];
          return next;
        });
      }
    } catch {
      if (cellRequestVersions.current[cellKey] !== requestVersion) {
        return;
      }
      setItems((previous) => previous.map((item) => {
        if (item.pageId !== pageId) {
          return item;
        }
        const currentProperties = parseProperties(item.propertiesJson);
        if (JSON.stringify(currentProperties[propertyId]) !== JSON.stringify(nextValue)) {
          return item;
        }
        if (hadPreviousValue) {
          currentProperties[propertyId] = previousValue;
        } else {
          delete currentProperties[propertyId];
        }
        return { ...item, propertiesJson: stringifyProperties(currentProperties) };
      }));
      setCellStates((previous) => ({ ...previous, [cellKey]: 'error' }));
      setStatusTemporarily('Could not update property');
    }
  };

  const filtered = useMemo(() => filterItems(items, filterBy, filterQuery), [items, filterBy, filterQuery]);
  const searched = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return filtered;
    }
    return filtered.filter((item) => {
      const values = parseProperties(item.propertiesJson);
      return item.page.title.toLowerCase().includes(query) || Object.values(values).some((value) => {
        const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
        return text.toLowerCase().includes(query);
      });
    });
  }, [filtered, searchQuery]);
  const ordered = useMemo(() => sortItems(searched, schema, sortBy, sortDirection), [searched, schema, sortBy, sortDirection]);
  const hostPagePreview = hostPage?.previewText ?? '';
  const focusedItem = useMemo(
    () => (embedded && focusPageId ? items.find((item) => item.pageId === focusPageId) ?? null : null),
    [embedded, focusPageId, items],
  );
  const pageUrlPages = useMemo<PageUrlPage[]>(() => {
    const map = new Map<string, PageUrlPage>();
    for (const page of availablePages) {
      map.set(page.id, page);
    }
    for (const item of items) {
      map.set(item.page.id, item.page);
    }
    if (hostPage) {
      map.set(hostPage.id, hostPage);
    }
    return Array.from(map.values());
  }, [availablePages, hostPage, items]);

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

  const isBooksCollection = [collection.name, hostPage?.title].some((value) => value?.toLowerCase().includes('book'));
  const tableProperties = embedded && isBooksCollection
    ? schema.properties.filter((property) => slugifyPropertyName(property.name) !== 'summary')
    : schema.properties;
  const showFocusedItem = embedded && focusPageId !== undefined;
  const showRowActions = !readOnly && !embedded;

  return (
    <div className={`collection-workspace ${hostPage ? 'has-host-page' : ''} ${isBooksCollection ? 'is-books-collection' : ''} ${embedded ? 'is-embedded' : ''}`}>
      {hostPage?.coverAssetId ? (
        <div className="collection-host-cover">
          <Image
            src={`/api/assets/${hostPage.coverAssetId}`}
            alt=""
            width={1600}
            height={320}
            className="collection-host-cover-image"
            style={{
              objectPosition: `${hostPage.coverFocalX}% ${hostPage.coverFocalY}%`,
              transform: `scale(${hostPage.coverScale / 100})`,
            }}
            unoptimized
          />
        </div>
      ) : null}

      <div className="collection-content">
        {!embedded && hostPage ? (
          <header className={`collection-host-identity ${hostPage.coverAssetId ? 'has-cover' : ''}`}>
            <span className="collection-host-icon" aria-hidden="true">{hostPage.icon ?? '📄'}</span>
            <div className="collection-host-copy">
              <Link href={buildWorkspacePagePathFromPages(hostPage.id, pageUrlPages, pageRouteBasePath)} className="page-link-block collection-host-title">{hostPage.title || 'Untitled'}<span className="page-link-arrow" aria-hidden="true">↗</span></Link>
              <p className="collection-host-description">{hostPagePreview || 'Read books imported from the Notion export.'}</p>
            </div>
          </header>
        ) : null}

        {!embedded && !readOnly ? (
          <header className="collection-header">
            <form onSubmit={setCollectionName} className="collection-name-form">
              <input name="name" defaultValue={collection.name} aria-label="Collection name" placeholder="Collection name" />
              <button type="submit" className="quiet-btn">Save name</button>
            </form>
            <span className="collection-count">{items.length} {items.length === 1 ? 'entry' : 'entries'}</span>
          </header>
        ) : null}

        {!embedded && readOnly ? (
          <header className="collection-header">
            <h1>{collection.name}</h1>
            <span className="collection-count">{items.length} {items.length === 1 ? 'entry' : 'entries'}</span>
          </header>
        ) : null}

        {!embedded && !readOnly ? (
          <div className="collection-viewbar" aria-label="Collection view controls">
            <div className="collection-view-tabs" role="tablist" aria-label="Collection views">
              <button type="button" role="tab" aria-selected={views.mode === 'table'} onClick={() => setViews((current) => ({ ...current, mode: 'table' }))}>▦ Table</button>
              <button type="button" role="tab" aria-selected={views.mode === 'gallery'} onClick={() => setViews((current) => ({ ...current, mode: 'gallery' }))}>▤ Gallery</button>
            </div>
            <label className="collection-search">
              <span className="visually-hidden">Search collection</span>
              <input aria-label="Search collection" placeholder="Search" value={searchQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)} />
            </label>
            <label className="compact-field" htmlFor="view-sort-by"><span>Sort</span>
              <select id="view-sort-by" value={sortBy} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortBy(event.target.value)}>
                <option value="sortKey">Default order</option>
                <option value="title">Page title</option>
                {schema.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            <select className="compact-select" aria-label="Sort direction" value={sortDirection} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortDirection(event.target.value as SortDirection)}>
              <option value="asc">Ascending</option><option value="desc">Descending</option>
            </select>
            <label className="compact-field" htmlFor="filter-property"><span>Filter</span>
              <select id="filter-property" value={filterBy} onChange={(event: ChangeEvent<HTMLSelectElement>) => setFilterBy(event.target.value)}>
                <option value="">No filter</option>
                {schema.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            {filterBy ? <input className="filter-query" aria-label="Filter query" placeholder="Filter query" value={filterQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setFilterQuery(event.target.value)} /> : null}
            <details className="add-entry-menu">
              <summary>New</summary>
              <div className="add-entry-panel">
                <form onSubmit={addNewEntry} className="entry-add-form">
                  <label>New page<input value={newPageTitle} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPageTitle(event.target.value)} placeholder="Page title" /></label>
                  <button type="submit" className="primary-btn">Create entry</button>
                </form>
                <form onSubmit={addExistingEntry} className="entry-add-form">
                  <label>Existing page<select value={existingPageId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setExistingPageId(event.target.value)}>
                    <option value="">Choose a page…</option>
                    {availablePages.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })).map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
                  </select></label>
                  <button type="submit" disabled={!existingPageId}>Add page</button>
                </form>
              </div>
            </details>
          </div>
        ) : null}

      {status && !embedded && !readOnly ? <p className="status-note" role="status">{status}</p> : null}

      <div className="collection-surface collection-surface-stage">
        {showFocusedItem ? (
          focusedItem ? (
            <section className="collection-focus-panel" aria-label="Collection entry properties">
              {schema.properties.length ? (
                <div className="collection-focus-properties">
                  {(() => {
                    const values = parseProperties(focusedItem.propertiesJson);
                    return schema.properties.map((property) => (
                      <div key={property.id} className="collection-focus-property" data-tone={getPropertyTone(property)}>
                        <span className="collection-focus-label"><span className="property-icon" aria-hidden="true">{PROPERTY_ICONS[property.type]}</span> {getDisplayPropertyName(property, isBooksCollection)}</span>
                        <div className="collection-focus-value">{renderFocusedPropertyValue(property, values[property.id])}</div>
                      </div>
                    ));
                  })()}
                </div>
              ) : <p className="help">No properties configured.</p>}
            </section>
          ) : <p className="help collection-state">This page is not in the collection.</p>
        ) : isLoading ? (
          <p className="help collection-state">Loading entries…</p>
        ) : items.length === 0 ? (
          <div className="collection-state"><h2>No entries yet</h2><p className="help">Create a page entry to begin this collection.</p></div>
        ) : ordered.length === 0 ? (
          <div className="no-results-state collection-state"><p className="help">No entries match the current search or filter.</p><button type="button" onClick={() => { setSearchQuery(''); setFilterBy(''); setFilterQuery(''); }}>Clear search and filter</button></div>
        ) : views.mode === 'gallery' ? (
          <section className="collection-gallery">
            {ordered.map((item, itemIndex) => {
              const image = getFirstImageUrl(item.page);
              const coverStyle = getCollectionCoverStyle(item.page);
              const values = parseProperties(item.propertiesJson);
              const staggerIndex = Math.min(itemIndex, MAX_COLLECTION_STAGGER_INDEX);
              return (
                <article
                  key={item.pageId}
                  className="collection-gallery-item"
                  style={{ '--motion-stagger-index': `${staggerIndex}` } as CSSProperties}
                >
                  {image && readOnly ? (
                    <PublishMediaTrigger
                      item={{ type: 'image', src: image, alt: `Cover for ${item.page.title}`, label: item.page.title || 'Collection cover' }}
                      className="collection-cover-link"
                    >
                      <Image src={image} alt={`Cover for ${item.page.title}`} className="collection-cover" width={640} height={360} style={coverStyle} unoptimized />
                    </PublishMediaTrigger>
                  ) : (
                    <Link href={buildWorkspacePagePathFromPages(item.pageId, pageUrlPages, pageRouteBasePath)} className="collection-cover-link">
                      {image ? <Image src={image} alt={`Cover for ${item.page.title}`} className="collection-cover" width={640} height={360} style={coverStyle} unoptimized /> : <div className="collection-cover-blank" aria-hidden="true">{item.page.icon ?? '◆'}</div>}
                    </Link>
                  )}
                  <div className="collection-card-body">
                    <div className="collection-card-title-row">
                      <Link href={buildWorkspacePagePathFromPages(item.pageId, pageUrlPages, pageRouteBasePath)} className="page-link-block collection-page-title"><PageIcon className="page-link-icon" icon={item.page.icon} iconAssetId={item.page.iconAssetId} /><span className="page-link-title">{item.page.title || 'Untitled'}<span className="page-link-arrow" aria-hidden="true">↗</span></span></Link>
                      {showRowActions ? <details className="row-menu"><summary aria-label={`Actions for ${item.page.title}`}>•••</summary><div><button type="button" onClick={() => void reorderEntry(item.pageId, 'up')}>Move up</button><button type="button" onClick={() => void reorderEntry(item.pageId, 'down')}>Move down</button><button type="button" className="danger-action" onClick={() => void removeEntry(item.pageId)}>Remove</button></div></details> : null}
                    </div>
                    {schema.properties.length ? <div className="collection-properties-grid">{schema.properties.slice(0, 4).map((property) => <div key={property.id}>{renderGalleryProperty(property, values[property.id])}</div>)}</div> : <p className="help">No properties configured.</p>}
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="collection-table-wrap">
            <table className="collection-table">
              <thead><tr><th className="collection-title-column"><span className="property-icon" aria-hidden="true">Aa</span> Name</th>{tableProperties.map((property) => <th key={property.id} className={`collection-property-column collection-property-${property.type} collection-property-${slugifyPropertyName(property.name)}`} data-tone={getPropertyTone(property)}><span className="property-icon" aria-hidden="true">{PROPERTY_ICONS[property.type]}</span> {getDisplayPropertyName(property, isBooksCollection)}</th>)}{showRowActions ? <th className="collection-actions-column"><span className="visually-hidden">Actions</span></th> : null}</tr></thead>
              <tbody>{ordered.map((item, itemIndex) => {
                const properties = parseProperties(item.propertiesJson);
                return <tr
                  key={item.pageId}
                  className="collection-row"
                  style={{ '--motion-stagger-index': `${Math.min(itemIndex, MAX_COLLECTION_STAGGER_INDEX)}` } as CSSProperties}
                >
                  <td className="collection-title-cell"><Link href={buildWorkspacePagePathFromPages(item.pageId, pageUrlPages, pageRouteBasePath)} className="page-link-block collection-page-title"><PageIcon className="page-link-icon" icon={item.page.icon} iconAssetId={item.page.iconAssetId} /><span className="page-link-title">{item.page.title || 'Untitled'}<span className="page-link-arrow" aria-hidden="true">↗</span></span></Link></td>
                  {tableProperties.map((property) => {
                    const cellKey = `${item.pageId}:${property.id}`;
                    const cellState = cellStates[cellKey];
                    return <td key={property.id} className={`collection-cell collection-property-${property.type} collection-property-${slugifyPropertyName(property.name)} ${cellState ? `is-${cellState}` : ''}`} data-tone={getPropertyTone(property)}>
                      {readOnly ? renderFocusedPropertyValue(property, properties[property.id], 'table') : <CollectionPropertyControl property={property} value={properties[property.id]} onCommit={(nextValue) => void updateEntryProperty(item.pageId, property.id, nextValue)} onEnsureOptions={(values) => ensurePropertyOptions(property.id, values)} disabled={false} />}
                      {!readOnly && cellState ? <span className="cell-state" role={cellState === 'error' ? 'alert' : 'status'}>{cellState === 'saving' ? 'Saving' : 'Not saved'}</span> : null}
                    </td>;
                  })}
                  {showRowActions ? <td><details className="row-menu"><summary aria-label={`Actions for ${item.page.title}`}>•••</summary><div><button type="button" onClick={() => void reorderEntry(item.pageId, 'up')}>Move up</button><button type="button" onClick={() => void reorderEntry(item.pageId, 'down')}>Move down</button><button type="button" className="danger-action" onClick={() => void removeEntry(item.pageId)}>Remove</button></div></details></td> : null}
                </tr>;
              })}</tbody>
            </table>
          </section>
        )}
      </div>

      {!embedded && !readOnly ? (
        <details className="collection-settings">
          <summary>Collection settings <span>{schema.properties.length} properties</span></summary>
          <div className="settings-panel">
            <section className="collection-properties">
              <h2>Properties</h2>
              {schema.properties.length ? (
                <ul className="collection-property-list">{schema.properties.map((property, index) => (
                  <CollectionPropertySettingsRow
                    key={property.id}
                    property={property}
                    index={index}
                    total={schema.properties.length}
                    onMove={reorderProperty}
                    onRemove={removeProperty}
                    onUpdate={updateProperty}
                  />
                ))}</ul>
              ) : <p className="help">No properties yet.</p>}
              <form onSubmit={addProperty} className="properties-form">
                <label>Name<input value={newPropertyName} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPropertyName(event.target.value)} placeholder="Property name" /></label>
                <label>Type<select value={newPropertyType} onChange={(event: ChangeEvent<HTMLSelectElement>) => setNewPropertyType(event.target.value as CollectionPropertyType)}>{PROPERTY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                {(newPropertyType === 'select' || newPropertyType === 'multi-select') ? <label>Options<input value={newPropertyOptions} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPropertyOptions(event.target.value)} placeholder="Comma-separated" /></label> : null}
                <button type="submit" className="primary-btn">Add property</button>
              </form>
            </section>
            <section className="danger-zone"><h2>Collection</h2><button type="button" onClick={deleteCollection} className="danger-btn">Delete collection</button></section>
          </div>
        </details>
      ) : null}
      </div>
    </div>
  );
}
