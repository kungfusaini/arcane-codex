import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/data/storage';
import { CollectionWorkspace } from '@/components/CollectionWorkspace';

export const dynamic = 'force-dynamic';

type RouteParams = {
  collectionId: string;
};

export default function CollectionRoute({ params }: { params: RouteParams }) {
  if (getSettings().publishedMode) {
    redirect(`/published/collections/${params.collectionId}`);
  }

  return <CollectionWorkspace collectionId={params.collectionId} />;
}
