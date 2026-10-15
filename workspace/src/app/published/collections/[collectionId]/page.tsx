import { notFound, redirect } from 'next/navigation';
import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { isPublishedAppSurface } from '@/lib/surface';
import { isCollectionPublished } from '@/lib/data/storage';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function PublishedCollectionRoute({ params }: { params: RouteParams }) {
  if (!isCollectionPublished(params.collectionId)) notFound();
  if (isPublishedAppSurface()) {
    redirect(`/collections/${params.collectionId}`);
  }
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
