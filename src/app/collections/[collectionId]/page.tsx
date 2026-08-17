import { CollectionEditor } from '@/components/CollectionEditor';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
  return <CollectionEditor collectionId={params.collectionId} />;
}
