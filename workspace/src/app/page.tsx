import { PageEditorRoute } from '@/app/page/PageEditorRoute';
import { PageWorkspaceLayout } from '@/app/page/PageWorkspaceLayout';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { getPage, getPublishedPage, listCollectionsHostedByPage, listPageSummaries, listPublishedPages } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';
import { findWorkspaceHomePage } from '@/lib/workspaceHome';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const readOnly = isPublishedAppSurface();
  const initialPages = (readOnly ? listPublishedPages(true) : listPageSummaries()).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    sortKey: page.sortKey,
    title: page.title,
    slug: page.slug,
    icon: page.icon,
    iconAssetId: page.iconAssetId,
    revision: page.revision,
  }));
  const initialSidebarPages = (readOnly ? listPublishedPages(false, undefined, false) : listPageSummaries(undefined, false)).map((page) => ({
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

  const initialPage = readOnly
    ? getPublishedPage(homePage.id) ?? undefined
    : listCollectionsHostedByPage(homePage.id).length ? undefined : getPage(homePage.id) ?? undefined;

  return (
    <PageWorkspaceLayout initialPageId={homePage.id} initialPages={initialPages} initialSidebarPages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/">
      <PageEditorRoute pageId={homePage.id} initialPage={initialPage} initialPages={initialPages} initialNavigablePages={initialSidebarPages} readOnly={readOnly} pageRouteBasePath="/" showDiscovery />
    </PageWorkspaceLayout>
  );
}
