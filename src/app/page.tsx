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

  const refreshPages = async () => {
    const response = await fetch('/api/pages');
    const payload = (await response.json()) as { pages: PageSummary[] };
    setPages(payload.pages);
    setLoading(false);
  };

  useEffect(() => {
    void refreshPages();
  }, []);

  const createFirstPage = async () => {
    const response = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Welcome', parentId: null }),
    });
    const payload = (await response.json()) as { page: PageSummary };
    window.location.href = `/page/${payload.page.id}`;
  };

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        onCreated={async () => {
          await refreshPages();
        }}
      />
      <main className="main-column">
        <h1>Workspace</h1>
        <section className="editor-shell">
          {loading ? (
            <p className="help">Loading workspace…</p>
          ) : pages.length ? (
            <>
              <p className="help">Your workspace has {pages.length} page{pages.length === 1 ? '' : 's'}.</p>
              <div className="toolbar">
                <Link href={`/page/${pages[0].id}`} className="text-link">
                  Open first page
                </Link>
                <button type="button" onClick={createFirstPage}>
                  Add another page
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>No pages yet</h2>
              <p className="help">Create your first page to start a private workspace.</p>
              <button type="button" onClick={createFirstPage}>
                Create first page
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
