import { CollectionsIndex } from '@/components/CollectionsIndex';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function CollectionsPage() {
  if (isPublishedAppSurface()) {
    return <CollectionsIndex readOnly collectionRouteBasePath="/collections" pageRouteBasePath="/" />;
  }

  return <CollectionsIndex />;
}
