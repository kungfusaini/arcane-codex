import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
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
  if (resolution.requestedPath !== resolution.canonicalPath.replace(/^\/page\//, '')) {
    permanentRedirect(toPublishedPath(resolution.canonicalPath));
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

  return <PageWorkspaceLayout initialPageId={resolution.pageId} initialPages={initialPages} readOnly pageRouteBasePath="/published" />;
}
