import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getPage, resolvePageRoutePath } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { toPublicPath } from '@/lib/workspaceMode';

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
  const pagePath = params.pagePath ?? [];
  if (!pagePath.length) {
    redirect('/');
  }
  const resolution = resolvePageRoutePath(pagePath);
  if (!resolution) {
    notFound();
  }
  if (isPublishedAppSurface()) {
    redirect(toPublicPath(resolution.canonicalPath));
  }
  if (resolution.requestedPath !== resolution.canonicalPath.replace(/^\/page\//, '').replace(/^\//, '')) {
    permanentRedirect(resolution.canonicalPath);
  }

  return null;
}
