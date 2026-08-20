import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { PageWorkspaceLayout } from '../PageWorkspaceLayout';
import { getPage, getSettings, listPageSummaries, resolvePageRoutePath } from '@/lib/data/storage';
import { toPublishedPath } from '@/lib/workspaceMode';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { pagePath?: string[] } }): Promise<Metadata> {
  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    return { title: 'Page not found' };
  }

  const page = getPage(resolution.pageId);
  if (!page) {
    return { title: 'Page not found' };
  }

  const title = page.title?.trim() || 'Untitled';
  return {
    title,
    description: `Arcane Codex page: ${title}`,
    alternates: {
      canonical: resolution.canonicalPath,
    },
  };
}

export default function PageRoute({ params }: { params: { pagePath?: string[] } }) {
  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    notFound();
  }
  if (getSettings().publishedMode) {
    redirect(toPublishedPath(resolution.canonicalPath));
  }
  if (resolution.requestedPath !== resolution.canonicalPath.replace(/^\/page\//, '')) {
    permanentRedirect(resolution.canonicalPath);
  }

  const initialPages = listPageSummaries().map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));

  return <PageWorkspaceLayout initialPageId={resolution.pageId} initialPages={initialPages} />;
}
