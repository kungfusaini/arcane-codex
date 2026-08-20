import { WorkspaceHome } from '@/components/WorkspaceHome';

export const dynamic = 'force-dynamic';

export default function PublishedHomePage() {
  return <WorkspaceHome readOnly pageRouteBasePath="/published" />;
}
