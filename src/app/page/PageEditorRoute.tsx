"use client";

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import type { PageUrlPage } from '@/lib/pageUrls';

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
  initialPages = [],
  readOnly = false,
  pageRouteBasePath = '/',
}: {
  pageId: string;
  initialPages?: LayoutPage[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  return <PageEditor pageId={pageId} initialPages={initialPages} readOnly={readOnly} pageRouteBasePath={pageRouteBasePath} />;
}
