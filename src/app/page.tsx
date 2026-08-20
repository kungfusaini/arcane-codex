import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/data/storage';
import { WorkspaceHome } from '@/components/WorkspaceHome';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  if (getSettings().publishedMode) {
    redirect('/published');
  }

  return <WorkspaceHome />;
}
