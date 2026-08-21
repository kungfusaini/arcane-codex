import { redirect } from 'next/navigation';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function PublishedHomePage() {
  if (isPublishedAppSurface()) {
    redirect('/');
  }
  return <WorkspaceHome readOnly pageRouteBasePath="/published" />;
}
