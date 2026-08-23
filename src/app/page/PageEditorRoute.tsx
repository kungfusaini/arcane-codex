"use client";

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import type { PageUrlPage } from '@/lib/pageUrls';

type InitialPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
  coverAssetId: string | null;
  coverFocalX: number;
  coverFocalY: number;
  coverScale: number;
  isArticle: boolean;
  contentJson: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

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
}: {
  pageId: string;
  initialPage?: InitialPage;
  initialPages?: LayoutPage[];
  initialNavigablePages?: LayoutPage[];
  readOnly?: boolean;
  pageRouteBasePath?: string;
}) {
  return <PageEditor pageId={pageId} initialPage={initialPage} initialPages={initialPages} initialNavigablePages={initialNavigablePages} readOnly={readOnly} pageRouteBasePath={pageRouteBasePath} />;
}
