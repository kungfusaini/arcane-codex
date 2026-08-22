import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { listPageSummaries } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
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
  if (isPublishedAppSurface()) {
    return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} readOnly pageRouteBasePath="/" collectionHomePath="/collections" homePath="/" />;
  }

  return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} />;
}
