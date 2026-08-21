import { redirect } from 'next/navigation';
import { CollectionsIndex } from '@/components/CollectionsIndex';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function PublishedCollectionsPage() {
  if (isPublishedAppSurface()) {
    redirect('/collections');
  }
  return <CollectionsIndex readOnly collectionRouteBasePath="/published/collections" pageRouteBasePath="/published" />;
}
