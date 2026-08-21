"use client";

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { buildPagePathFromPages, resolvePagePathname, type PageUrlPage } from '@/lib/pageUrls';

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
  readOnly = false,
  pageRouteBasePath = '/page',
}: {
  children?: React.ReactNode;
  initialPageId?: string | null;
  initialPages?: LayoutPage[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
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

  const resolvedPageId = loaded && pathname ? resolvePagePathname(pathname, pages) : null;
  const pageId = initialPageId ?? resolvedPageId;
  const isPageRoute = Boolean(pathname?.startsWith(pageRouteBasePath));

  return (
    <div className="layout-shell">
      <WorkspaceSidebar
        currentPageId={pageId ?? undefined}
        readOnly={readOnly}
        pageRouteBasePath={pageRouteBasePath}
        collectionHomePath={readOnly ? `${pageRouteBasePath.replace(/\/+$/, '')}/collections` || '/collections' : '/collections'}
        homePath={readOnly ? pageRouteBasePath : '/'}
        onCreated={readOnly ? undefined : (page) => {
          if (page) {
            router.push(buildPagePathFromPages(page.id, [...pages, page], pageRouteBasePath));
          }
        }}
      />
      <main className="main-column page-main">
        {!loaded && isPageRoute ? <DelayedPageEditorSkeleton /> : pageId ? <PageEditor pageId={pageId} initialPages={initialPages} readOnly={readOnly} pageRouteBasePath={pageRouteBasePath} /> : children}
      </main>
    </div>
  );
}
