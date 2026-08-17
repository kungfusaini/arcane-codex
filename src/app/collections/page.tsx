"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

type CollectionSummary = {
  id: string;
  hostPageId: string | null;
  name: string;
  schemaJson: string;
  createdAt: number;
  updatedAt: number;
};

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

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    const response = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });

    if (!response.ok) {
      setStatus('Failed to create collection');
      return;
    }

    setName('');
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
      <main className="main-column">
        <h1>Collections</h1>

        <section className="editor-shell">
          <form onSubmit={onCreate} className="collections-create-form">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New collection name"
              aria-label="Collection name"
            />
            <button type="submit" disabled={!name.trim()}>Create collection</button>
          </form>

          {status && status !== 'Failed to load collections' ? <p className="status-note">{status}</p> : null}

          {isLoading ? (
            <p className="help">Loading collections…</p>
          ) : sorted.length ? (
            <ul className="collections-list">
              {sorted.map((collection) => (
                <li key={collection.id} className="collection-card">
                  <div>
                    <Link href={`/collections/${collection.id}`} className="collection-title text-link">
                      {collection.name}
                    </Link>
                    <p className="help">
                      {collection.propertyCount} propert{collection.propertyCount === 1 ? 'y' : 'ies'} ·
                      {collection.hostPageId ? ' linked to page' : ' standalone'}
                    </p>
                  </div>
                  <Link href={`/collections/${collection.id}`} className="text-link mini-btn">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          ) : status === 'Failed to load collections' ? (
            <div className="recovery-notice error" role="alert">
              <strong>{status}</strong>
              <button type="button" onClick={() => void loadCollections()}>Retry loading collections</button>
            </div>
          ) : (
            <p className="help">No collections yet. Create one to begin building structured tables.</p>
          )}
        </section>
      </main>
    </div>
  );
}
