"use client";

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import type { PageUrlPage } from '@/lib/pageUrls';
import type { PageRecord } from '@/lib/data/types';

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

export function PageEditorRoute({
  pageId,
  initialPage,
  initialPages = [],
  initialNavigablePages,
  readOnly = false,
  pageRouteBasePath = '/',
  showDiscovery = false,
}: {
  pageId: string;
  initialPage?: PageRecord;
  initialPages?: LayoutPage[];
  initialNavigablePages?: LayoutPage[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
  showDiscovery?: boolean;
}) {
  return <PageEditor pageId={pageId} initialPage={initialPage} initialPages={initialPages} initialNavigablePages={initialNavigablePages} readOnly={readOnly} pageRouteBasePath={pageRouteBasePath} showDiscovery={showDiscovery} />;
}
