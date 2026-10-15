import { CollectionsIndex } from '@/components/CollectionsIndex';
import { listPageSummaries, listPublishedPages } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function CollectionsPage() {
  const published = isPublishedAppSurface();
  const initialPages = (published ? listPublishedPages(false, undefined, false) : listPageSummaries(undefined, false)).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  if (published) {
    return <CollectionsIndex initialPages={initialPages} readOnly collectionRouteBasePath="/collections" pageRouteBasePath="/" />;
  }

  return <CollectionsIndex initialPages={initialPages} />;
}
