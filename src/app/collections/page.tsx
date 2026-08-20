"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

type CollectionPropertyType = 'text' | 'number' | 'select' | 'multi-select' | 'checkbox' | 'date' | 'url';

type CollectionSummary = {
  id: string;
  hostPageId: string | null;
  name: string;
  schemaJson: string;
  createdAt: number;
  updatedAt: number;
};

type DraftProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options: string;
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

const BOOK_TEMPLATE_PROPERTIES: DraftProperty[] = [
  { id: 'author', name: 'Author', type: 'select', options: '' },
  { id: 'status', name: 'Status', type: 'select', options: 'To read, Reading, Finished' },
  { id: 'type', name: 'Type', type: 'multi-select', options: '' },
  { id: 'score', name: 'Score /5', type: 'number', options: '' },
  { id: 'tags', name: 'Tags', type: 'multi-select', options: '' },
];

function createDraftProperty(type: CollectionPropertyType = 'text'): DraftProperty {
  return {
    id: `property-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: '',
    type,
    options: '',
  };
}

function createBookDraftProperties(): DraftProperty[] {
  return BOOK_TEMPLATE_PROPERTIES.map((property) => ({
    ...property,
    id: `property-${property.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  }));
}

function draftPropertiesToSchema(properties: DraftProperty[]): { properties: { id: string; name: string; type: CollectionPropertyType; options?: string[] }[] } {
  return {
    properties: properties
      .map((property) => {
        const name = property.name.trim();
        if (!name) {
          return null;
        }

        const options =
          property.type === 'select' || property.type === 'multi-select'
            ? property.options
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean)
            : [];

        return {
          id: property.id,
          name,
          type: property.type,
          ...(options.length ? { options } : {}),
        };
      })
      .filter((property): property is { id: string; name: string; type: CollectionPropertyType; options?: string[] } => Boolean(property)),
  };
}

function safeParseSchema(schemaJson: string): { properties: { id: string; name: string; type: string }[] } {
  try {
    const parsed = JSON.parse(schemaJson) as {
      properties?: unknown;
    };
    if (Array.isArray(parsed?.properties)) {
      return {
        properties: parsed.properties as { id: string; name: string; type: string }[],
      };
    }
  } catch {
    // ignore malformed JSON
  }
  return { properties: [] };
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'empty' | 'book'>('empty');
  const [draftProperties, setDraftProperties] = useState<DraftProperty[]>([]);
  const [status, setStatus] = useState('');

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/collections');
      const payload = (await response.json()) as { collections: CollectionSummary[] };
      setCollections(payload.collections);
      setStatus('');
    } catch {
      setStatus('Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    setDraftProperties(template === 'book' ? createBookDraftProperties() : []);
  }, [template]);

  const addProperty = () => {
    setDraftProperties((current) => [...current, createDraftProperty()]);
  };

  const updateProperty = (propertyId: string, updates: Partial<DraftProperty>) => {
    setDraftProperties((current) => current.map((property) => (property.id === propertyId ? { ...property, ...updates } : property)));
  };

  const removeProperty = (propertyId: string) => {
    setDraftProperties((current) => current.filter((property) => property.id !== propertyId));
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    const response = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: trimmed,
        schema: draftPropertiesToSchema(draftProperties),
      }),
    });

    if (!response.ok) {
      setStatus('Failed to create collection');
      return;
    }

    setName('');
    setTemplate('empty');
    setDraftProperties([]);
    await loadCollections();
    setStatus('Collection created');
    setTimeout(() => setStatus(''), 1200);
  };

  const sorted = useMemo(
    () =>
      collections
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((collection) => {
          const parsed = safeParseSchema(collection.schemaJson);
          return {
            ...collection,
            propertyCount: parsed.properties.length,
            propertyPreview: parsed.properties.slice(0, 3).map((property) => property.name).join(', '),
          };
        }),
    [collections],
  );

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        onCreated={() => {
          loadCollections().catch(() => {
            setStatus('Unable to refresh collections');
          });
        }}
      />
      <main className="main-column collections-index-main">
        <section className="collections-index">
          <header className="index-header">
            <div>
              <p className="eyebrow">Structured knowledge</p>
              <h1>Collections</h1>
            </div>
            <details className="create-collection-menu">
              <summary>New collection</summary>
              <form onSubmit={onCreate} className="collections-create-form">
                <label>
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" aria-label="Collection name" />
                </label>
                <label>
                  Start from
                  <select value={template} onChange={(event) => setTemplate(event.target.value as 'empty' | 'book')} aria-label="Collection template">
                    <option value="empty">Blank schema</option>
                    <option value="book">Book attributes</option>
                  </select>
                </label>
                <div className="collection-create-attributes">
                  <div className="collection-create-attributes-header">
                    <strong>Attributes</strong>
                    <button type="button" className="mini-btn" onClick={addProperty}>Add attribute</button>
                  </div>
                  {draftProperties.length ? (
                    <ul className="collection-attribute-list">
                      {draftProperties.map((property) => (
                        <li key={property.id} className="collection-attribute-item">
                          <label>
                            Attribute name
                            <input
                              value={property.name}
                              onChange={(event) => updateProperty(property.id, { name: event.target.value })}
                              placeholder="Attribute name"
                            />
                          </label>
                          <label>
                            Type
                            <select value={property.type} onChange={(event) => updateProperty(property.id, { type: event.target.value as CollectionPropertyType })}>
                              {PROPERTY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          {(property.type === 'select' || property.type === 'multi-select') ? (
                            <label>
                              Options
                              <input
                                value={property.options}
                                onChange={(event) => updateProperty(property.id, { options: event.target.value })}
                                placeholder="Comma-separated options"
                              />
                            </label>
                          ) : null}
                          <button type="button" className="mini-btn danger-action collection-attribute-remove" onClick={() => removeProperty(property.id)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="help">Add attributes now or choose the book preset to start with a useful schema.</p>
                  )}
                </div>
                <button type="submit" className="primary-btn" disabled={!name.trim()}>Create</button>
              </form>
            </details>
          </header>
          {status && status !== 'Failed to load collections' ? <p className="status-note" role="status">{status}</p> : null}
          {isLoading ? (
            <p className="help">Loading collections…</p>
          ) : sorted.length ? (
            <ul className="collections-list">
              {sorted.map((collection) => (
                <li key={collection.id}>
                  <Link href={`/collections/${collection.id}`} className="collection-index-row">
                    <span className="collection-index-icon" aria-hidden="true">▦</span>
                    <span>
                      <strong>{collection.name}</strong>
                      <small>
                        {collection.propertyCount} propert{collection.propertyCount === 1 ? 'y' : 'ies'}
                        {collection.propertyPreview ? ` · ${collection.propertyPreview}` : ''}
                        {collection.hostPageId ? ' · linked' : ' · standalone'}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : status === 'Failed to load collections' ? (
            <div className="recovery-notice error" role="alert"><strong>{status}</strong><button type="button" onClick={() => void loadCollections()}>Retry loading collections</button></div>
          ) : (
            <div className="collection-state"><h2>No collections yet</h2><p className="help">Create one when a set of pages needs shared properties.</p></div>
          )}
        </section>
      </main>
    </div>
  );
}
