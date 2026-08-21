import { WorkspaceHome } from '@/components/WorkspaceHome';
import { isPublishedAppSurface } from '@/lib/surface';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  if (isPublishedAppSurface()) {
    return <WorkspaceHome readOnly pageRouteBasePath="/" />;
  }

  return <WorkspaceHome />;
}
