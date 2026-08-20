import { CollectionWorkspace } from '@/components/CollectionWorkspace';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function PublishedCollectionRoute({ params }: { params: RouteParams }) {
  return (
    <CollectionWorkspace
      collectionId={params.collectionId}
      readOnly
      pageRouteBasePath="/published"
      collectionHomePath="/published/collections"
      homePath="/published"
    />
  );
}
