"use client";

import { CollectionEditor } from '@/components/CollectionEditor';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { usePublishedPreview } from '@/components/usePublishedPreview';
import { getWorkspaceHomePathFromBase } from '@/lib/workspaceHome';

export function CollectionWorkspace({
  collectionId,
  readOnly = false,
  pageRouteBasePath = '/',
  collectionHomePath = '/collections',
  homePath = getWorkspaceHomePathFromBase(pageRouteBasePath),
}: {
  collectionId: string;
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
