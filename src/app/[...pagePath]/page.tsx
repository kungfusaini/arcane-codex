import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { getPage, listPageSummaries, resolvePageRoutePath } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { buildPagePathFromPages } from '@/lib/pageUrls';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { pagePath?: string[] } }): Promise<Metadata> {
  if (!isPublishedAppSurface()) {
    return { title: 'Page not found' };
  }
  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    return { title: 'Page not found' };
  }

  const page = getPage(resolution.pageId);
  if (!page) {
    return { title: 'Page not found' };
  }

  const title = page.title?.trim() || 'Untitled';
  const pages = listPageSummaries();
  return {
    title,
    description: `Arcane Codex published page: ${title}`,
    alternates: {
      canonical: buildPagePathFromPages(resolution.pageId, pages, '/'),
    },
  };
}

export default function PublicPageRoute({ params }: { params: { pagePath?: string[] } }) {
  if (!isPublishedAppSurface()) {
    notFound();
  }

  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    notFound();
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
  const canonicalPath = buildPagePathFromPages(resolution.pageId, initialPages, '/');
  if (`/${resolution.requestedPath}` !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }

  return <PageWorkspaceLayout initialPageId={resolution.pageId} initialPages={initialPages} readOnly pageRouteBasePath="/" />;
}
