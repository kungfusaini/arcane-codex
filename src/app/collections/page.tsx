import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/data/storage';
import { CollectionsIndex } from '@/components/CollectionsIndex';

export const dynamic = 'force-dynamic';

export default function CollectionsPage() {
  if (getSettings().publishedMode) {
    redirect('/published/collections');
  }

  return <CollectionsIndex />;
}
