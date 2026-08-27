"use client";

import Link from 'next/link';
import { CollectionEditor } from '@/components/CollectionEditor';
import type { CollectionDetailPayload } from '@/lib/data/collectionPayload';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { usePublishedPreview } from '@/components/usePublishedPreview';
import { getWorkspaceHomePathFromBase } from '@/lib/workspaceHome';

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

export function CollectionWorkspace({
  collectionId,
  initialPages = [],
  readOnly = false,
  pageRouteBasePath = '/',
  collectionHomePath = '/collections',
  homePath = getWorkspaceHomePathFromBase(pageRouteBasePath),
  initialCollectionPayload = null,
}: {
  collectionId: string;
  initialPages?: PageSummary[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
  collectionHomePath?: string;
  homePath?: string;
  initialCollectionPayload?: CollectionDetailPayload | null;
}) {
  const { previewPublished, effectiveReadOnly, canTogglePreview, setPreviewPublished } = usePublishedPreview(readOnly);
  const onCreated = effectiveReadOnly ? undefined : () => {
    window.dispatchEvent(new Event('arcane-pages-changed'));
  };

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        initialPages={initialPages}
        readOnly={effectiveReadOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={collectionHomePath}
        homePath={homePath}
        previewPublished={previewPublished}
        canTogglePreview={canTogglePreview}
        onPreviewPublishedChange={setPreviewPublished}
        onCreated={onCreated}
      />
      <main className="main-column page-main">
        <section className="document-shell" aria-live="polite">
          <header className="document-topbar">
            <nav className="breadcrumbs" aria-label="Breadcrumbs">
              <Link className="text-link" href={homePath}>Workspace</Link>
              <span className="breadcrumb-separator" aria-hidden="true">/</span>
              <Link className="text-link" href={collectionHomePath}>Collections</Link>
            </nav>
          </header>
          <div className="document-content collection-document-content">
            <CollectionEditor collectionId={collectionId} readOnly={effectiveReadOnly} pageRouteBasePath={pageRouteBasePath} initialPayload={initialCollectionPayload} />
          </div>
        </section>
      </main>
    </div>
  );
}
