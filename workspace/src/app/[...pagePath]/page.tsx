import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { PageEditorRoute } from '@/app/page/PageEditorRoute';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { getPage, listCollectionsHostedByPage, listPageSummaries, resolvePageRoutePath } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { buildWorkspacePagePathFromPages } from '@/lib/workspaceHome';

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
  const pages = listPageSummaries();
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
  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    notFound();
  }

  const initialPage = listCollectionsHostedByPage(resolution.pageId).length ? undefined : getPage(resolution.pageId) ?? undefined;
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
  const initialSidebarPages = listPageSummaries(undefined, false).map((page) => ({
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
