"use client";

import { CollectionEditor } from '@/components/CollectionEditor';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

export function CollectionWorkspace({
  collectionId,
  readOnly = false,
  pageRouteBasePath = '/page',
  collectionHomePath = '/collections',
  homePath = '/',
}: {
  collectionId: string;
  readOnly?: boolean;
  pageRouteBasePath?: string;
  collectionHomePath?: string;
  homePath?: string;
}) {
  const onCreated = readOnly ? undefined : () => {
    window.dispatchEvent(new Event('arcane-pages-changed'));
  };

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        readOnly={readOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={collectionHomePath}
        homePath={homePath}
        onCreated={onCreated}
      />
      <main className="main-column collection-main">
        <CollectionEditor collectionId={collectionId} readOnly={readOnly} pageRouteBasePath={pageRouteBasePath} />
      </main>
    </div>
  );
}
