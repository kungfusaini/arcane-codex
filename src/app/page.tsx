"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

type PageSummary = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  revision: number;
};

export default function HomePage() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshPages = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pages');
      if (!response.ok) {
        throw new Error('Workspace could not be loaded.');
      }
      const payload = (await response.json()) as { pages: PageSummary[] };
      setPages(payload.pages);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPages();
  }, []);

  const createFirstPage = async () => {
    try {
      const response = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', parentId: null }),
      });
      const payload = (await response.json().catch(() => ({}))) as { page?: PageSummary; error?: string };
      if (!response.ok || !payload.page) {
        throw new Error(payload.error || 'Page could not be created.');
      }
      window.location.href = `/page/${payload.page.id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Page could not be created.');
    }
  };

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        onCreated={async () => {
          await refreshPages();
        }}
      />
      <main className="main-column home-main">
        <section className="home-workspace">
          {loading ? (
            <p className="help" role="status">Loading workspace…</p>
          ) : error ? (
            <div className="recovery-notice error" role="alert">
              <strong>{error}</strong>
              <button type="button" onClick={() => void refreshPages()}>Retry loading workspace</button>
            </div>
          ) : pages.length ? (
            <>
              <header className="home-header"><div><p className="eyebrow">Private workspace</p><h1>Continue writing</h1></div><button type="button" className="primary-btn" onClick={createFirstPage}>New page</button></header>
              <Link href={`/page/${pages[0].id}`} className="recent-page">
                <span className="recent-page-icon">{pages[0].icon ?? '📄'}</span>
                <span><strong>{pages[0].title || 'Untitled'}</strong><small>Open most recent page</small></span>
                <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : (
            <div className="home-empty">
              <span className="empty-mark" aria-hidden="true">✦</span>
              <h1>Begin your codex</h1>
              <p>Capture a note, then let pages grow into a connected workspace.</p>
              <button type="button" className="primary-btn" onClick={createFirstPage}>Create first page</button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
