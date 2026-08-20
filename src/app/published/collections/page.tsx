import { CollectionsIndex } from '@/components/CollectionsIndex';

export const dynamic = 'force-dynamic';

export default function PublishedCollectionsPage() {
  return <CollectionsIndex readOnly collectionRouteBasePath="/published/collections" pageRouteBasePath="/published" />;
}
