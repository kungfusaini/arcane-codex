"use client";

import { CollectionEditor } from '@/components/CollectionEditor';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={undefined}
        onCreated={() => {
          window.dispatchEvent(new Event('arcane-pages-changed'));
        }}
      />
      <main className="main-column">
        <h1>Collection</h1>
        <CollectionEditor collectionId={params.collectionId} />
      </main>
    </div>
  );
}
