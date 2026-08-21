import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
  if (isPublishedAppSurface()) {
    return <CollectionWorkspace collectionId={params.collectionId} readOnly pageRouteBasePath="/" collectionHomePath="/collections" homePath="/" />;
  }

  return <CollectionWorkspace collectionId={params.collectionId} />;
}
