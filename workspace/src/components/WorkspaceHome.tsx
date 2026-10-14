"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { usePublishedPreview } from '@/components/usePublishedPreview';
import { PageIcon } from '@/components/PageIcon';
import { buildWorkspacePagePathFromPages, getWorkspaceHomePath, getWorkspaceTopLevelPages } from '@/lib/workspaceHome';

type PageSummary = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  slug?: string | null;
  icon: string | null;
  iconAssetId: string | null;
  revision: number;
};

export function WorkspaceHome({
  initialPages = [],
  readOnly = false,
  pageRouteBasePath = '/',
}: {
  initialPages?: PageSummary[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  const { previewPublished, effectiveReadOnly, canTogglePreview, setPreviewPublished } = usePublishedPreview(readOnly);
  const [pages, setPages] = useState<PageSummary[]>(initialPages);
  const [loading, setLoading] = useState(initialPages.length === 0);
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
    if (initialPages.length === 0) {
      void refreshPages();
    }
  }, [initialPages.length]);

  useEffect(() => {
    if (initialPages.length > 0) {
      setPages(initialPages);
      setLoading(false);
    }
  }, [initialPages]);

  const createFirstPage = async () => {
    if (effectiveReadOnly) {
      return;
    }
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
      window.location.href = buildWorkspacePagePathFromPages(payload.page.id, [...pages, payload.page], pageRouteBasePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Page could not be created.');
    }
  };

  const homePath = getWorkspaceHomePath(pages, pageRouteBasePath);
  const topLevelPages = getWorkspaceTopLevelPages(pages);

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        initialPages={initialPages}
        readOnly={effectiveReadOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={readOnly ? `${pageRouteBasePath.replace(/\/+$/, '')}/collections` || '/collections' : '/collections'}
        homePath={homePath}
        previewPublished={previewPublished}
        canTogglePreview={canTogglePreview}
        onPreviewPublishedChange={setPreviewPublished}
        onCreated={effectiveReadOnly ? undefined : async () => {
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
              <header className="home-header">
                <div>
                  <p className="eyebrow">{effectiveReadOnly ? 'Published workspace' : 'Private workspace'}</p>
                  <h1>{effectiveReadOnly ? 'Browse pages' : 'Continue writing'}</h1>
                </div>
                {effectiveReadOnly ? null : <button type="button" className="primary-btn" onClick={createFirstPage}>New page</button>}
              </header>
              <div className="home-page-links" aria-label="Top-level pages">
                {topLevelPages.length ? topLevelPages.map((page) => (
                  <Link key={page.id} href={buildWorkspacePagePathFromPages(page.id, pages, pageRouteBasePath)} className="page-link-block">
                    <PageIcon className="page-link-icon" icon={page.icon} iconAssetId={page.iconAssetId} />
                    <span className="page-link-title">{page.title || 'Untitled'}</span>
                    <span className="page-link-arrow" aria-hidden="true">↗</span>
                  </Link>
                )) : <p className="help">No top-level pages yet.</p>}
              </div>
            </>
          ) : effectiveReadOnly ? (
            <div className="home-empty">
              <span className="empty-mark" aria-hidden="true">✦</span>
              <h1>Nothing published yet</h1>
              <p>Pages will appear here once the workspace has content.</p>
            </div>
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
