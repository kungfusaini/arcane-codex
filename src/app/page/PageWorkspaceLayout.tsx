"use client";

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { usePublishedPreview } from '@/components/usePublishedPreview';
import { buildPagePathFromPages, resolvePagePathname, type PageUrlPage } from '@/lib/pageUrls';
import { getWorkspaceHomePath } from '@/lib/workspaceHome';

type LayoutPage = PageUrlPage & {
  icon: string | null;
  iconAssetId: string | null;
  revision: number;
};

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

export function PageWorkspaceLayout({
  children,
  readOnly = false,
  pageRouteBasePath = '/',
}: {
  children: React.ReactNode;
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { previewPublished, effectiveReadOnly, canTogglePreview, setPreviewPublished } = usePublishedPreview(readOnly);
  const [pages, setPages] = useState<LayoutPage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadPages = async () => {
      try {
        const response = await fetch('/api/pages');
        const payload = (await response.json()) as { pages?: LayoutPage[] };
        if (!cancelled) {
          setPages(payload.pages ?? []);
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };

    void loadPages();
    const refresh = () => void loadPages();
    window.addEventListener('arcane-pages-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('arcane-pages-changed', refresh);
    };
  }, []);

  const pageId = loaded && pathname ? resolvePagePathname(pathname, pages) : null;
  const isManagedPageRoute = pageRouteBasePath === '/page' && Boolean(pathname?.startsWith('/page'));
  const homePath = getWorkspaceHomePath(pages, pageRouteBasePath);

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={pageId ?? undefined}
        readOnly={effectiveReadOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={readOnly ? `${pageRouteBasePath.replace(/\/+$/, '')}/collections` || '/collections' : '/collections'}
        homePath={homePath}
        previewPublished={previewPublished}
        canTogglePreview={canTogglePreview}
        onPreviewPublishedChange={setPreviewPublished}
        onCreated={effectiveReadOnly ? undefined : (page) => {
          if (page) {
            router.push(buildPagePathFromPages(page.id, [...pages, page], pageRouteBasePath));
          }
        }}
      />
      <main className="main-column page-main">
        {isManagedPageRoute ? (
          !loaded ? <DelayedPageEditorSkeleton /> : pageId ? <PageEditor pageId={pageId} initialPages={pages} readOnly={effectiveReadOnly} pageRouteBasePath={pageRouteBasePath} /> : children
        ) : children}
      </main>
    </div>
  );
}
