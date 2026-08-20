import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { getPage, listPageSummaries, resolvePageRoutePath } from '@/lib/data/storage';

function toPublishedPath(path: string): string {
  return path.replace(/^\/page\//, '/published/');
}

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
