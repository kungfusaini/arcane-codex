import { redirect } from 'next/navigation';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { listPublishedPages } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function PublishedHomePage() {
  if (isPublishedAppSurface()) {
    redirect('/');
  }
  const initialPages = listPublishedPages(false, undefined, false).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  return <WorkspaceHome initialPages={initialPages} readOnly pageRouteBasePath="/published" />;
}
