"use client";

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';

const PageEditor = dynamic(
  () => import('@/components/PageEditor').then((module) => module.PageEditor),
  { ssr: false, loading: () => <DelayedPageEditorSkeleton /> },
);

function DelayedPageEditorSkeleton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? <PageEditorSkeleton /> : <div className="editor-shell page-transition-placeholder" aria-hidden="true" />;
}

export function PageWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const pageId = pathname.match(/^\/page\/([^/]+)/)?.[1];

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={pageId}
        onCreated={(page) => {
          if (page) {
            router.push(`/page/${page.id}`);
          }
        }}
      />
      <main className="main-column page-main">{pageId ? <PageEditor pageId={pageId} /> : children}</main>
    </div>
  );
}
