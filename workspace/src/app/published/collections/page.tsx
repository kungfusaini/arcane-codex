import { redirect } from 'next/navigation';
import { CollectionsIndex } from '@/components/CollectionsIndex';
import { listPageSummaries } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function PublishedCollectionsPage() {
  if (isPublishedAppSurface()) {
    redirect('/collections');
  }
  const initialPages = listPageSummaries(undefined, false).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  return <CollectionsIndex initialPages={initialPages} readOnly collectionRouteBasePath="/published/collections" pageRouteBasePath="/published" />;
}
