import { notFound } from 'next/navigation';
import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { getCollectionDetailPayload } from '@/lib/data/collectionPayload';
import { isCollectionPublished, listPageSummaries, listPublishedPages } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
  const published = isPublishedAppSurface();
  if (published && !isCollectionPublished(params.collectionId)) notFound();
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
  const initialCollectionPayload = getCollectionDetailPayload(params.collectionId, { published });

  if (published) {
    return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} initialCollectionPayload={initialCollectionPayload} readOnly pageRouteBasePath="/" collectionHomePath="/collections" homePath="/" />;
  }

  return <CollectionWorkspace collectionId={params.collectionId} initialPages={initialPages} initialCollectionPayload={initialCollectionPayload} />;
}
