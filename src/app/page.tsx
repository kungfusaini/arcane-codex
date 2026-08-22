import { PageEditorRoute } from '@/app/page/PageEditorRoute';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { getPage, listPageSummaries } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { findWorkspaceHomePage } from '@/lib/workspaceHome';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const readOnly = isPublishedAppSurface();
  const initialPages = listPageSummaries().map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  const initialSidebarPages = listPageSummaries(undefined, false).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  const homePage = findWorkspaceHomePage(initialPages);

  if (!homePage) {
    return <WorkspaceHome initialPages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/" />;
  }

  const initialPage = getPage(homePage.id) ?? undefined;

  return (
    <PageWorkspaceLayout initialPageId={homePage.id} initialPages={initialPages} initialSidebarPages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/">
      <PageEditorRoute pageId={homePage.id} initialPage={initialPage} initialPages={initialPages} readOnly={readOnly} pageRouteBasePath="/" />
    </PageWorkspaceLayout>
  );
}
