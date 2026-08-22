"use client";

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { cloneElement, isValidElement, useEffect, useState, type ReactElement } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { usePublishedPreview } from '@/components/usePublishedPreview';
import type { PageUrlPage } from '@/lib/pageUrls';
import { buildWorkspacePagePathFromPages, getWorkspaceHomePath, resolveWorkspacePagePathname } from '@/lib/workspaceHome';

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
  initialPageId = null,
  initialPages = [],
  initialSidebarPages,
  readOnly = false,
  pageRouteBasePath = '/',
}: {
  children?: React.ReactNode;
  initialPageId?: string | null;
  initialPages?: LayoutPage[];
  initialSidebarPages?: LayoutPage[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { previewPublished, effectiveReadOnly, canTogglePreview, setPreviewPublished } = usePublishedPreview(readOnly);
  const sidebarPages = initialSidebarPages ?? initialPages;
  const [pages, setPages] = useState<LayoutPage[]>(initialPages);
  const [loaded, setLoaded] = useState(initialPageId !== null || initialPages.length > 0);

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

    if (!loaded) {
      void loadPages();
    }
    const refresh = () => void loadPages();
    window.addEventListener('arcane-pages-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('arcane-pages-changed', refresh);
    };
  }, [loaded]);

  useEffect(() => {
    if (initialPages.length > 0) {
      setPages(initialPages);
      setLoaded(true);
    }
  }, [initialPages]);

  const resolvedPageId = loaded && pathname ? resolveWorkspacePagePathname(pathname, pages) : null;
  const pageId = initialPageId ?? resolvedPageId;
  const isManagedPageRoute = pageRouteBasePath === '/page' && Boolean(pathname?.startsWith('/page'));
  const homePath = getWorkspaceHomePath(pages, pageRouteBasePath);
  const workspaceModeKey = effectiveReadOnly ? 'published' : 'editor';
  const renderedChildren = isValidElement(children)
    ? cloneElement(children as ReactElement<{ readOnly?: boolean }>, { readOnly: effectiveReadOnly, key: workspaceModeKey })
    : children;

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={pageId ?? undefined}
        initialPages={sidebarPages}
        readOnly={effectiveReadOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={readOnly ? `${pageRouteBasePath.replace(/\/+$/, '')}/collections` || '/collections' : '/collections'}
        homePath={homePath}
        previewPublished={previewPublished}
        canTogglePreview={canTogglePreview}
        onPreviewPublishedChange={setPreviewPublished}
        onCreated={effectiveReadOnly ? undefined : (page) => {
          if (page) {
            router.push(buildWorkspacePagePathFromPages(page.id, [...pages, page], pageRouteBasePath));
          }
        }}
      />
      <main className="main-column page-main">
        {isManagedPageRoute ? (
          !loaded ? <DelayedPageEditorSkeleton /> : pageId ? <PageEditor key={`${pageId}:${workspaceModeKey}`} pageId={pageId} initialPages={pages} readOnly={effectiveReadOnly} pageRouteBasePath={pageRouteBasePath} /> : renderedChildren
        ) : renderedChildren}
      </main>
    </div>
  );
}
