import { buildPagePathFromPages, resolvePagePathSegments, type PageUrlPage } from './pageUrls';

export const WORKSPACE_HOME_SLUG = 'arcane-codex';

export function findWorkspaceHomePage<T extends PageUrlPage>(pages: T[]): T | undefined {
  return pages.find((page) => page.parentId === null && (page.slug || '').toLowerCase() === WORKSPACE_HOME_SLUG);
}

function normalizeBasePath(basePath = '/'): string {
  return basePath === '/' || basePath.trim() === '' ? '' : basePath.replace(/\/+$/, '') || '';
}

export function getWorkspaceHomePathFromBase(basePath = '/'): string {
  return normalizeBasePath(basePath) || '/';
}

export function getWorkspaceHomePath(pages: PageUrlPage[], basePath = '/'): string {
  return findWorkspaceHomePage(pages) ? getWorkspaceHomePathFromBase(basePath) : basePath;
}

export function getWorkspaceTopLevelPages<T extends PageUrlPage>(pages: T[], homeSlug = WORKSPACE_HOME_SLUG): T[] {
  return promoteWorkspaceHomeChildren(pages, homeSlug).filter((page) => page.parentId === null);
}

export function buildWorkspacePagePathFromPages(pageId: string, pages: PageUrlPage[], basePath = '/', homeSlug = WORKSPACE_HOME_SLUG): string {
  const homePage = findWorkspaceHomePage(pages);
  if (!homePage) {
    return buildPagePathFromPages(pageId, pages, basePath);
  }
  if (pageId === homePage.id) {
    return getWorkspaceHomePathFromBase(basePath);
  }
  return buildPagePathFromPages(pageId, promoteWorkspaceHomeChildren(pages, homeSlug), basePath);
}

export function resolveWorkspacePagePathSegments(segments: string[], pages: PageUrlPage[], homeSlug = WORKSPACE_HOME_SLUG): string | null {
  const homePage = findWorkspaceHomePage(pages);
  if (!homePage) {
    return resolvePagePathSegments(segments, pages);
  }

  const cleanSegments = segments.map((segment) => segment.trim()).filter(Boolean);
  if (!cleanSegments.length) {
    return homePage.id;
  }

  if (cleanSegments[0] === homeSlug) {
    return cleanSegments.length === 1
      ? homePage.id
      : resolvePagePathSegments(cleanSegments.slice(1), promoteWorkspaceHomeChildren(pages, homeSlug));
  }

  return resolvePagePathSegments(cleanSegments, promoteWorkspaceHomeChildren(pages, homeSlug));
}

export function resolveWorkspacePagePathname(pathname: string, pages: PageUrlPage[]): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const pageIndex = segments.indexOf('page');
  if (pageIndex >= 0) {
    return resolveWorkspacePagePathSegments(segments.slice(pageIndex + 1), pages);
  }
  const publishedIndex = segments.indexOf('published');
  if (publishedIndex >= 0) {
    return resolveWorkspacePagePathSegments(segments.slice(publishedIndex + 1), pages);
  }
  return resolveWorkspacePagePathSegments(segments, pages);
}

export function isWorkspacePagePathForId(pathname: string, pageId: string, pages: PageUrlPage[]): boolean {
  return resolveWorkspacePagePathname(pathname, pages) === pageId;
}

export function promoteWorkspaceHomeChildren<T extends PageUrlPage>(pages: T[], homeSlug = WORKSPACE_HOME_SLUG): T[] {
  const homePage = pages.find((page) => page.parentId === null && (page.slug || '').toLowerCase() === homeSlug);
  if (!homePage) {
    return pages;
  }

  return pages
    .filter((page) => page.id !== homePage.id)
    .map((page) => (page.parentId === homePage.id ? { ...page, parentId: null } : page));
}
