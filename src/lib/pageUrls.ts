export type PageUrlPage = {
  id: string;
  parentId: string | null;
  title: string;
  sortKey: number;
  slug?: string | null;
};

export function slugifyPageTitle(value: string | null | undefined, fallback = 'page'): string {
  const normalized = (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function comparePages(left: PageUrlPage, right: PageUrlPage): number {
  return (left.sortKey - right.sortKey)
    || left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id);
}

function pageSlug(page: PageUrlPage): string {
  return slugifyPageTitle(page.slug || page.title);
}

function pageById(pages: PageUrlPage[]): Map<string, PageUrlPage> {
  return new Map(pages.map((page) => [page.id, page]));
}

export function buildPagePathFromPages(pageId: string, pages: PageUrlPage[]): string {
  const byId = pageById(pages);
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(pageId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(pageSlug(current));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return `/page/${chain.length ? chain.join('/') : slugifyPageTitle(byId.get(pageId)?.title)}`;
}

export function resolvePagePathSegments(segments: string[], pages: PageUrlPage[]): string | null {
  const cleanSegments = segments.map((segment) => segment.trim()).filter(Boolean);
  if (!cleanSegments.length) {
    return null;
  }

  const legacyId = cleanSegments.length === 1 ? extractLegacyPageId(cleanSegments[0]) : null;
  if (legacyId && pages.some((page) => page.id === legacyId)) {
    return legacyId;
  }

  let parentId: string | null = null;
  let matched: PageUrlPage | undefined;

  for (const segment of cleanSegments) {
    matched = pages
      .filter((page) => page.parentId === parentId)
      .sort(comparePages)
      .find((page) => pageSlug(page) === segment);
    if (!matched) {
      return null;
    }
    parentId = matched.id;
  }

  return matched?.id ?? null;
}

export function resolvePagePathname(pathname: string, pages: PageUrlPage[]): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const pageIndex = segments.indexOf('page');
  return pageIndex >= 0 ? resolvePagePathSegments(segments.slice(pageIndex + 1), pages) : null;
}

export function extractLegacyPageId(segment: string | null | undefined): string | null {
  if (!segment) {
    return null;
  }

  const trimmed = segment.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf('--');
  if (separatorIndex >= 0) {
    const pageId = trimmed.slice(separatorIndex + 2);
    return pageId || null;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

export function isPagePathForId(pathname: string, pageId: string, pages: PageUrlPage[]): boolean {
  return resolvePagePathname(pathname, pages) === pageId;
}
