"use client";

import { CollectionEditor } from '@/components/CollectionEditor';
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
}: {
  collectionId: string;
  initialPages?: PageSummary[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
  collectionHomePath?: string;
  homePath?: string;
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
      <main className="main-column collection-main">
        <CollectionEditor collectionId={collectionId} readOnly={effectiveReadOnly} pageRouteBasePath={pageRouteBasePath} />
      </main>
    </div>
  );
}
