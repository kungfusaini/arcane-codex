import { redirect } from 'next/navigation';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { listPageSummaries } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { getWorkspaceHomePath } from '@/lib/workspaceHome';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const pages = listPageSummaries();
  const homePath = getWorkspaceHomePath(pages, '/');
  if (homePath !== '/') {
    redirect(homePath);
  }

  if (isPublishedAppSurface()) {
    return <WorkspaceHome readOnly pageRouteBasePath="/" />;
  }

  return <WorkspaceHome />;
}
