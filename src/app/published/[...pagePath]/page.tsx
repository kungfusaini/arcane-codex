import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { PageEditorRoute } from '@/app/page/PageEditorRoute';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { getPage, listPageSummaries, resolvePageRoutePath } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { toPublicPath, toPublishedPath } from '@/lib/workspaceMode';

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
    description: `Arcane Codex published page: ${title}`,
    alternates: {
      canonical: toPublishedPath(resolution.canonicalPath),
    },
  };
}

export default function PublishedPageRoute({ params }: { params: { pagePath?: string[] } }) {
  const resolution = resolvePageRoutePath(params.pagePath ?? []);
  if (!resolution) {
    notFound();
  }
  if (isPublishedAppSurface()) {
    redirect(toPublicPath(resolution.canonicalPath));
  }
  if (resolution.requestedPath !== resolution.canonicalPath.replace(/^\/page\//, '').replace(/^\//, '')) {
    permanentRedirect(toPublishedPath(resolution.canonicalPath));
  }

  const initialPage = getPage(resolution.pageId) ?? undefined;
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

  return (
    <PageWorkspaceLayout initialPageId={resolution.pageId} initialPages={initialPages} initialSidebarPages={initialSidebarPages} readOnly pageRouteBasePath="/published">
      <PageEditorRoute pageId={resolution.pageId} initialPage={initialPage} initialPages={initialPages} initialNavigablePages={initialSidebarPages} readOnly pageRouteBasePath="/published" />
    </PageWorkspaceLayout>
  );
}
