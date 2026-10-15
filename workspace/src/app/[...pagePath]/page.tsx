import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { PageEditorRoute } from '@/app/page/PageEditorRoute';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { getPage, getPublishedPage, listCollectionsHostedByPage, listPageSummaries, listPublishedPages, resolvePageRoutePath, resolvePublishedPageRoutePath } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { buildWorkspacePagePathFromPages } from '@/lib/workspaceHome';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { pagePath?: string[] } }): Promise<Metadata> {
  const published = isPublishedAppSurface();
  const resolution = published ? resolvePublishedPageRoutePath(params.pagePath ?? []) : resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    return { title: 'Page not found' };
  }

  const page = published ? getPublishedPage(resolution.pageId) : getPage(resolution.pageId);
  if (!page) {
    return { title: 'Page not found' };
  }

  const title = page.title?.trim() || 'Untitled';
  const pages = published ? listPublishedPages(true) : listPageSummaries();
  return {
    title,
    description: `Arcane Codex published page: ${title}`,
    alternates: {
      canonical: buildWorkspacePagePathFromPages(resolution.pageId, pages, '/'),
    },
  };
}

export default function PublicPageRoute({ params }: { params: { pagePath?: string[] } }) {
  const readOnly = isPublishedAppSurface();
  const resolution = readOnly ? resolvePublishedPageRoutePath(params.pagePath ?? []) : resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    notFound();
  }

  const initialPage = readOnly
    ? getPublishedPage(resolution.pageId) ?? undefined
    : listCollectionsHostedByPage(resolution.pageId).length ? undefined : getPage(resolution.pageId) ?? undefined;
  const initialPages = (readOnly ? listPublishedPages(true) : listPageSummaries()).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  const initialSidebarPages = (readOnly ? listPublishedPages(false, undefined, false) : listPageSummaries(undefined, false)).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  const canonicalPath = buildWorkspacePagePathFromPages(resolution.pageId, initialPages, '/');
  if (`/${resolution.requestedPath}` !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }

  return (
    <PageWorkspaceLayout initialPageId={resolution.pageId} initialPages={initialPages} initialSidebarPages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/">
      <PageEditorRoute pageId={resolution.pageId} initialPage={initialPage} initialPages={initialPages} initialNavigablePages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/" />
    </PageWorkspaceLayout>
  );
}
