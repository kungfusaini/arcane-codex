"use client";

import dynamic from 'next/dynamic';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

const PageEditor = dynamic(
  () => import('@/components/PageEditor').then((module) => module.PageEditor),
  {
    ssr: false,
    loading: () => <div className="editor-shell help" role="status">Loading page editor…</div>,
  },
);

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
