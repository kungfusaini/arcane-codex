import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { getCollectionDetailPayload } from '@/lib/data/collectionPayload';
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
  const initialCollectionPayload = getCollectionDetailPayload(params.collectionId);

  if (isPublishedAppSurface()) {
    return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} initialCollectionPayload={initialCollectionPayload} readOnly pageRouteBasePath="/" collectionHomePath="/collections" homePath="/" />;
  }

  return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} initialCollectionPayload={initialCollectionPayload} />;
}
