import { buildPagePathFromPages, type PageUrlPage } from './pageUrls';

export const WORKSPACE_HOME_SLUG = 'arcane-codex';

export function findWorkspaceHomePage<T extends PageUrlPage>(pages: T[]): T | undefined {
  return pages.find((page) => page.parentId === null && (page.slug || '').toLowerCase() === WORKSPACE_HOME_SLUG);
}

export function getWorkspaceHomePathFromBase(basePath = '/', homeSlug = WORKSPACE_HOME_SLUG): string {
  const trimmedBasePath = basePath === '/' || basePath.trim() === '' ? '' : basePath.replace(/\/+$/, '') || '';
  return `${trimmedBasePath}/${homeSlug}`;
}

export function getWorkspaceHomePath(pages: PageUrlPage[], basePath = '/'): string {
  const homePage = findWorkspaceHomePage(pages);
  return homePage ? buildPagePathFromPages(homePage.id, pages, basePath) : basePath;
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
