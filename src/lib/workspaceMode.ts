function normalizeWorkspacePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) {
    return '/';
  }
  const slashPrefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return slashPrefixed.replace(/\/+$/, '') || '/';
}

export function toPublishedPath(pathname: string): string {
  const normalized = normalizeWorkspacePath(pathname);
  if (normalized === '/') {
    return '/published';
  }
  if (normalized === '/published' || normalized.startsWith('/published/')) {
    return normalized;
  }
  if (normalized === '/collections') {
    return '/published/collections';
  }
  if (normalized.startsWith('/collections/')) {
    return normalized.replace(/^\/collections/, '/published/collections');
  }
  if (normalized === '/page') {
    return '/published';
  }
  if (normalized.startsWith('/page/')) {
    return normalized.replace(/^\/page/, '/published');
  }
  return `/published${normalized}`;
}

export function toPublicPath(pathname: string): string {
  const normalized = normalizeWorkspacePath(pathname);
  if (normalized === '/' || normalized === '/page' || normalized === '/published') {
    return '/';
  }
  if (normalized === '/collections' || normalized.startsWith('/collections/')) {
    return normalized;
  }
  if (normalized === '/published/collections') {
    return '/collections';
  }
  if (normalized.startsWith('/published/collections/')) {
    return normalized.replace(/^\/published\/collections/, '/collections');
  }
  if (normalized.startsWith('/published/')) {
    return normalized.replace(/^\/published/, '');
  }
  if (normalized.startsWith('/page/')) {
    return normalized.replace(/^\/page/, '');
  }
  return normalized;
}

export function toPrivatePath(pathname: string): string {
  const normalized = normalizeWorkspacePath(pathname);
  if (normalized === '/' || normalized === '/page') {
    return '/';
  }
  if (normalized === '/published') {
    return '/';
  }
  if (normalized === '/collections' || normalized.startsWith('/collections/')) {
    return normalized;
  }
  if (normalized === '/published/collections') {
    return '/collections';
  }
  if (normalized.startsWith('/published/collections/')) {
    return normalized.replace(/^\/published\/collections/, '/collections');
  }
  if (normalized.startsWith('/published/')) {
    return normalized.replace(/^\/published/, '/page');
  }
  return normalized;
}

export function toWorkspacePath(pathname: string, publishedMode: boolean): string {
  return publishedMode ? toPublishedPath(pathname) : toPrivatePath(pathname);
}
