"use client";

import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { PageEditor } from '@/components/PageEditor';

export default function PageRoute({ params }: { params: { pageId: string } }) {
  const { pageId } = params;

  return (
    <div className="layout-shell">
      <WorkspaceSidebar currentPageId={pageId} onCreated={() => {
        window.location.reload();
      }} />
      <main className="main-column">
        <h1>Arcane Codex</h1>
        <PageEditor pageId={pageId} />
      </main>
    </div>
  );
}
