import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import {
  AssetRecord,
  CollectionItemPayload,
  CollectionItemRecord,
  CollectionPropertiesPatch,
  CollectionRecord,
  CollectionSchema,
  CollectionUpdateItemSort,
  CollectionViews,
  NewPage,
  PageMoveInput,
  PageRecord,
  PageUpdate,
  RevisionConflictError,
} from './types';
import {
  ensureWorkspaceDirs,
  getWorkspaceAssetsDir,
  getWorkspaceDbPath,
  getWorkspaceBaseDir,
} from './workspace';
import { buildPagePathFromPages, extractLegacyPageId, slugifyPageTitle, type PageUrlPage } from '../pageUrls';
import { buildWorkspacePagePathFromPages, resolveWorkspacePagePathSegments } from '../workspaceHome';

const CURRENT_SCHEMA_VERSION = 7;

const DEFAULT_COVER_FOCAL_PERCENT = 50;

export type StorageHandle = {
  dbPath: string;
  dataDir: string;
};

export type WorkspaceHealth = {
  status: 'ok' | 'degraded' | 'error';
  checkedAt: string;
  issues: string[];
  recovery: string[];
};

export class WorkspaceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceIntegrityError';
  }
}

type DbRow = Record<string, unknown>;

function assertDatabaseIntegrity(db: DatabaseSync): void {
  const quickCheck = db.prepare('PRAGMA quick_check').all() as DbRow[];
  const failures = quickCheck
    .map((row) => String(row.quick_check ?? 'unknown integrity error'))
    .filter((result) => result !== 'ok');
  if (failures.length) {
    throw new WorkspaceIntegrityError(`Workspace database integrity check failed: ${failures.join('; ')}`);
  }

  const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all() as DbRow[];
  if (foreignKeyFailures.length) {
    throw new WorkspaceIntegrityError(`Workspace database contains ${foreignKeyFailures.length} invalid relationship(s).`);
  }
}

export function openWorkspace(options?: { dataDir?: string }): StorageHandle {
  const workspaceDir = getWorkspaceBaseDir(options?.dataDir);
  ensureWorkspaceDirs(options?.dataDir);
  const dbPath = getWorkspaceDbPath(options?.dataDir);
  const db = new DatabaseSync(dbPath);

  try {
    ensurePragmas(db);
    runMigrations(db);

    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get() as
      | DbRow
      | undefined;
    if (!row) {
      throw new WorkspaceIntegrityError('Migration failed to create workspace settings.');
    }

    const settings = db.prepare('SELECT COUNT(*) as count FROM settings').get() as DbRow;
    const now = Date.now();
    if (!(Number(settings.count) > 0)) {
      db.prepare(
        'INSERT INTO settings (schema_version, workspace_name, published_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', 0, now, now);
    } else {
      db.prepare('UPDATE settings SET schema_version = ?, updated_at = ? WHERE schema_version != ?')
        .run(CURRENT_SCHEMA_VERSION, now, CURRENT_SCHEMA_VERSION);
    }

    assertDatabaseIntegrity(db);
    return { dbPath, dataDir: workspaceDir };
  } finally {
    db.close();
  }
}

function ensurePragmas(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
}

function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version;').get() as DbRow;
  const currentVersion = Number(row.user_version ?? 0);

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new WorkspaceIntegrityError(
      `Workspace schema version ${currentVersion} is newer than this Arcane Codex build supports (${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  if (currentVersion < 1) {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
        sort_key REAL NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        icon TEXT,
        icon_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        cover_focal_x REAL NOT NULL DEFAULT 50,
        cover_focal_y REAL NOT NULL DEFAULT 50,
        cover_scale REAL NOT NULL DEFAULT 100,
        content_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS page_links (
        source_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        source_block_id TEXT NOT NULL,
        target_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        PRIMARY KEY (source_page_id, source_block_id)
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        host_page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        schema_json TEXT NOT NULL DEFAULT '{}',
        views_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        properties_json TEXT NOT NULL DEFAULT '{}',
        sort_key REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, page_id)
      );

      CREATE TABLE IF NOT EXISTS page_path_aliases (
        alias_path TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        schema_version INTEGER NOT NULL,
        workspace_name TEXT NOT NULL,
        published_mode INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (schema_version)
      );

      CREATE INDEX IF NOT EXISTS idx_pages_parent_sort ON pages(parent_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(deleted_at, parent_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_collection_items_sort ON collection_items(collection_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_page_path_aliases_page_id ON page_path_aliases(page_id);
    `;
    db.exec(schemaSql);
    db.exec('PRAGMA user_version = 1;');
  }

  if (currentVersion < 2) {
    // Older workspaces may already contain duplicate hashes. Keep startup recoverable;
    // uploads are serialized and deduplicated in createAsset.
    db.exec('CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);');
    db.exec('PRAGMA user_version = 2;');
  }

  if (currentVersion < 3) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'cover_focal_x')) {
      db.exec('ALTER TABLE pages ADD COLUMN cover_focal_x REAL NOT NULL DEFAULT 50;');
    }
    if (!pageColumns.some((column) => column.name === 'cover_focal_y')) {
      db.exec('ALTER TABLE pages ADD COLUMN cover_focal_y REAL NOT NULL DEFAULT 50;');
    }
    db.exec('PRAGMA user_version = 3;');
  }

  if (currentVersion < 4) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'cover_scale')) {
      db.exec('ALTER TABLE pages ADD COLUMN cover_scale REAL NOT NULL DEFAULT 100;');
    }
    db.exec('PRAGMA user_version = 4;');
  }

  if (currentVersion < 5) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'icon_asset_id')) {
      db.exec('ALTER TABLE pages ADD COLUMN icon_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;');
    }
    db.exec('PRAGMA user_version = 5;');
  }

  const pageColumnsForSlugs = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
  if (!pageColumnsForSlugs.some((column) => column.name === 'slug')) {
    db.exec("ALTER TABLE pages ADD COLUMN slug TEXT NOT NULL DEFAULT '';");
  }
  db.exec('CREATE TABLE IF NOT EXISTS page_path_aliases (alias_path TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_page_path_aliases_page_id ON page_path_aliases(page_id);');

  if (currentVersion < 6) {
    db.exec('PRAGMA user_version = 6;');
  }

  if (currentVersion < 7) {
    const settingsColumns = db.prepare('PRAGMA table_info(settings);').all() as Array<{ name: string }>;
    if (!settingsColumns.some((column) => column.name === 'published_mode')) {
      db.exec('ALTER TABLE settings ADD COLUMN published_mode INTEGER NOT NULL DEFAULT 0;');
    }
    db.exec('PRAGMA user_version = 7;');
  }

  const rowsMissingSlugs = db.prepare("SELECT id, parent_id, sort_key, slug, title FROM pages WHERE slug = '' ORDER BY parent_id IS NULL DESC, parent_id, sort_key, title COLLATE NOCASE ASC").all() as DbRow[];
  if (rowsMissingSlugs.length) {
    const rows = db.prepare('SELECT id, parent_id, sort_key, slug, title FROM pages ORDER BY parent_id IS NULL DESC, parent_id, sort_key, title COLLATE NOCASE ASC').all() as DbRow[];
    const pages = rows.map((entry) => ({
      id: String(entry.id),
      parentId: (entry.parent_id as string | null) ?? null,
      sortKey: Number(entry.sort_key),
      title: String(entry.title),
      slug: String(entry.slug ?? ''),
    }));
    const updateSlug = db.prepare('UPDATE pages SET slug = ? WHERE id = ?');
    for (const page of pages) {
      if (page.slug) {
        continue;
      }
      const slug = getUniquePageSlug(page.title, page.parentId, pages, page.id);
      page.slug = slug;
      updateSlug.run(slug, page.id);
    }
  }

  if (currentVersion !== CURRENT_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
  }
}

export function createStorageConnection(dataDir?: string): DatabaseSync {
  const workspace = openWorkspace({ dataDir });
  const db = new DatabaseSync(workspace.dbPath);
  ensurePragmas(db);
  return db;
}

function hasValidJson(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function inspectWorkspaceHealth(dataDir?: string): WorkspaceHealth {
  const checkedAt = new Date().toISOString();
  const issues: string[] = [];
  const recovery = new Set<string>();
  let workspace: StorageHandle;

  try {
    workspace = openWorkspace({ dataDir });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workspace could not be opened.';
    return {
      status: 'error',
      checkedAt,
      issues: [message],
      recovery: [
        'Stop Arcane Codex and copy the workspace directory before attempting repair.',
        'Restore workspace.sqlite from a known-good backup or export.',
      ],
    };
  }

  const db = new DatabaseSync(workspace.dbPath, { readOnly: true });
  try {
    assertDatabaseIntegrity(db);

    const assets = db.prepare('SELECT id, filename FROM assets ORDER BY id').all() as DbRow[];
    const expectedFiles = new Set<string>();
    for (const asset of assets) {
      const filename = `${String(asset.id)}${path.extname(String(asset.filename))}`;
      expectedFiles.add(filename);
      if (!existsSync(path.join(getWorkspaceAssetsDir(dataDir), filename))) {
        issues.push(`Asset file is missing: ${String(asset.filename)} (${String(asset.id)}).`);
        recovery.add('Re-upload missing assets or restore the assets directory from backup.');
      }
    }

    for (const filename of readdirSync(getWorkspaceAssetsDir(dataDir))) {
      if (!expectedFiles.has(filename)) {
        issues.push(`Unregistered file is present in the assets directory: ${filename}.`);
        recovery.add('Keep unregistered files until you confirm they are not needed, then move them out of the workspace.');
      }
    }

    const pages = db.prepare('SELECT id, content_json FROM pages ORDER BY id').all() as DbRow[];
    for (const page of pages) {
      if (!hasValidJson(page.content_json)) {
        issues.push(`Page ${String(page.id)} has invalid content JSON.`);
        recovery.add('Export the workspace to retain raw page content, then repair the affected page from the export warning.');
      }
    }

    const collections = db.prepare('SELECT id, schema_json, views_json FROM collections ORDER BY id').all() as DbRow[];
    for (const collection of collections) {
      if (!hasValidJson(collection.schema_json) || !hasValidJson(collection.views_json)) {
        issues.push(`Collection ${String(collection.id)} has invalid schema or view JSON.`);
        recovery.add('Export collection CSV data before repairing the collection definition.');
      }
    }

    const items = db.prepare('SELECT collection_id, page_id, properties_json FROM collection_items ORDER BY collection_id, page_id').all() as DbRow[];
    for (const item of items) {
      if (!hasValidJson(item.properties_json)) {
        issues.push(`Collection item ${String(item.collection_id)}/${String(item.page_id)} has invalid properties JSON.`);
        recovery.add('Export collection CSV data before repairing item properties.');
      }
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Workspace health check failed.');
    recovery.add('Stop Arcane Codex and copy the workspace directory before attempting repair.');
  } finally {
    db.close();
  }

  return {
    status: issues.length ? 'degraded' : 'ok',
    checkedAt,
    issues,
    recovery: [...recovery],
  };
}

function sanitizeFocal(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    if (parsed < 0) {
      return 0;
    }
    if (parsed > 100) {
      return 100;
    }
    return parsed;
  }

  return fallback;
}

const DEFAULT_COVER_SCALE_PERCENT = 100;

function sanitizeCoverScale(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    if (parsed < 100) {
      return 100;
    }
    if (parsed > 200) {
      return 200;
    }
    return parsed;
  }

  return fallback;
}

function rowToPage(row: DbRow): PageRecord {
  return {
    id: String(row.id),
    parentId: (row.parent_id as string | null) ?? null,
    sortKey: Number(row.sort_key),
    title: String(row.title),
    slug: String(row.slug ?? row.title ?? ''),
    icon: (row.icon as string | null) ?? null,
    iconAssetId: (row.icon_asset_id as string | null) ?? null,
    coverAssetId: (row.cover_asset_id as string | null) ?? null,
    coverFocalX: sanitizeFocal(row.cover_focal_x, DEFAULT_COVER_FOCAL_PERCENT),
    coverFocalY: sanitizeFocal(row.cover_focal_y, DEFAULT_COVER_FOCAL_PERCENT),
    coverScale: sanitizeCoverScale(row.cover_scale, DEFAULT_COVER_SCALE_PERCENT),
    contentJson: String(row.content_json),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

function rowToPageUrlPage(row: DbRow): PageUrlPage {
  const page = rowToPage(row);
  return {
    id: page.id,
    parentId: page.parentId,
    title: page.title,
    sortKey: page.sortKey,
    slug: page.slug,
  };
}

function buildPathMap(pages: PageUrlPage[]): Map<string, string> {
  return new Map(pages.map((page) => [page.id, buildPagePathFromPages(page.id, pages)]));
}

function syncPagePathAliases(db: DatabaseSync, beforePages: PageUrlPage[], afterPages: PageUrlPage[]): void {
  const beforePaths = buildPathMap(beforePages);
  const afterPaths = buildPathMap(afterPages);
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO page_path_aliases (alias_path, page_id, created_at) VALUES (?, ?, ?)',
  );
  const now = Date.now();
  for (const [pageId, beforePath] of beforePaths) {
    const afterPath = afterPaths.get(pageId);
    if (!afterPath || beforePath === afterPath) {
      continue;
    }
    stmt.run(beforePath.replace(/^\/page\//, '').replace(/^\//, ''), pageId, now);
  }
}

function getUniqueSlugFromBase(base: string | null | undefined, parentId: string | null, pages: PageUrlPage[], currentId?: string): string {
  const normalized = slugifyPageTitle(base);
  const siblingSlugs = new Set(
    pages
      .filter((page) => page.parentId === parentId && page.id !== currentId)
      .map((page) => slugifyPageTitle(page.slug || page.title)),
  );
  if (!siblingSlugs.has(normalized)) {
    return normalized;
  }
  let index = 2;
  while (siblingSlugs.has(`${normalized}-${index}`)) {
    index += 1;
  }
  return `${normalized}-${index}`;
}

function getUniquePageSlug(title: string, parentId: string | null, pages: PageUrlPage[], currentId?: string): string {
  return getUniqueSlugFromBase(title, parentId, pages, currentId);
}

function getLivePageUrlPages(db: DatabaseSync): PageUrlPage[] {
  const rows = db.prepare(
    'SELECT id, parent_id, sort_key, slug, title FROM pages WHERE deleted_at IS NULL ORDER BY parent_id IS NULL DESC, parent_id, sort_key, title COLLATE NOCASE ASC',
  ).all() as DbRow[];
  return rows.map(rowToPageUrlPage);
}

export type PageRouteResolution = {
  pageId: string;
  canonicalPath: string;
  requestedPath: string;
};

export function resolvePageRoutePath(segments: string[], dataDir?: string): PageRouteResolution | null {
  const cleanSegments = segments.map((segment) => segment.trim()).filter(Boolean);
  const db = createStorageConnection(dataDir);
  try {
    const pages = getLivePageUrlPages(db);
    const requestedPath = cleanSegments.join('/');
    const resolvedPageId = resolveWorkspacePagePathSegments(cleanSegments, pages);
    if (resolvedPageId) {
      return {
        pageId: resolvedPageId,
        canonicalPath: buildWorkspacePagePathFromPages(resolvedPageId, pages),
        requestedPath,
      };
    }

    const legacyId = cleanSegments.length === 1 ? extractLegacyPageId(cleanSegments[0]) : null;
    if (legacyId && pages.some((page) => page.id === legacyId)) {
      return {
        pageId: legacyId,
        canonicalPath: buildWorkspacePagePathFromPages(legacyId, pages),
        requestedPath,
      };
    }

    const aliasRow = db.prepare('SELECT page_id FROM page_path_aliases WHERE alias_path = ?').get(requestedPath) as DbRow | undefined;
    const aliasPageId = aliasRow?.page_id ? String(aliasRow.page_id) : null;
    if (aliasPageId && pages.some((page) => page.id === aliasPageId)) {
      return {
        pageId: aliasPageId,
        canonicalPath: buildWorkspacePagePathFromPages(aliasPageId, pages),
        requestedPath,
      };
    }

    return null;
  } finally {
    db.close();
  }
}

function sanitizeFilename(filename: string): string {
  const safe = filename
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\- .()]+/g, '_')
    .replace(/(^\.+|\.+$)/g, '');
  return safe || 'upload';
}

export type AssetCreateResult = {
  asset: AssetRecord;
  created: boolean;
};

function rowToAsset(row: DbRow): AssetRecord {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sha256: String(row.sha256),
    size: Number(row.size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    createdAt: Number(row.created_at),
  };
}

function rowToCollection(row: DbRow): CollectionRecord {
  return {
    id: String(row.id),
    hostPageId: (row.host_page_id as string | null) ?? null,
    name: String(row.name),
    schemaJson: String(row.schema_json),
    viewsJson: String(row.views_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export type PageSummaryRecord = Omit<PageRecord, 'contentJson'>;

function rowToPageSummary(row: DbRow): PageSummaryRecord {
  const page = rowToPage({
    ...row,
    content_json: '[]',
  }) as Partial<PageRecord>;
  delete page.contentJson;
  return page as PageSummaryRecord;
}

function collectionMembershipFilterClause(includeCollectionPages: boolean): string {
  return includeCollectionPages ? '' : ' AND id NOT IN (SELECT page_id FROM collection_items)';
}

export function listPageSummaries(dataDir?: string, includeCollectionPages = true): PageSummaryRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL${collectionMembershipFilterClause(includeCollectionPages)}
         ORDER BY parent_id IS NULL DESC, sort_key ASC, title COLLATE NOCASE ASC`,
      )
      .all() as DbRow[];
    return rows.map(rowToPageSummary);
  } finally {
    db.close();
  }
}

export function listTrashPageSummaries(dataDir?: string): PageSummaryRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NOT NULL
         ORDER BY updated_at DESC`,
      )
      .all() as DbRow[];
    return rows.map(rowToPageSummary);
  } finally {
    db.close();
  }
}

export function listPages(dataDir?: string, includeCollectionPages = true): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL${collectionMembershipFilterClause(includeCollectionPages)}
         ORDER BY parent_id IS NULL DESC, sort_key ASC, title COLLATE NOCASE ASC`,
      )
      .all() as DbRow[];
    return rows.map(rowToPage);
  } finally {
    db.close();
  }
}

export function listTrashPages(dataDir?: string): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NOT NULL
         ORDER BY updated_at DESC`,
      )
      .all() as DbRow[];
    return rows.map(rowToPage);
  } finally {
    db.close();
  }
}

export function getPage(id: string, dataDir?: string): PageRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE id = ?`,
      )
      .get(id) as DbRow | undefined;
    return row ? rowToPage(row) : null;
  } finally {
    db.close();
  }
}

export function createPage(input: NewPage, dataDir?: string): PageRecord {
  const now = Date.now();
  const pageId = randomUUID();
  const sortKey = input.sortKey !== undefined ? input.sortKey : Number.parseFloat(`${now}.${Math.floor(Math.random() * 1000)}`);
  const db = createStorageConnection(dataDir);
  let inTransaction = false;

  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const livePages = getLivePageUrlPages(db);
    const slug = getUniquePageSlug(input.title, input.parentId ?? null, livePages);
    const stmt = db.prepare(`
      INSERT INTO pages (id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
    `);
    stmt.run(
      pageId,
      input.parentId ?? null,
      sortKey,
      slug,
      input.title,
      input.icon ?? null,
      input.iconAssetId ?? null,
      input.coverAssetId ?? null,
      sanitizeFocal(input.coverFocalX, DEFAULT_COVER_FOCAL_PERCENT),
      sanitizeFocal(input.coverFocalY, DEFAULT_COVER_FOCAL_PERCENT),
      sanitizeCoverScale(input.coverScale, DEFAULT_COVER_SCALE_PERCENT),
      input.contentJson ?? '[]',
      now,
      now,
    );
    rebuildBacklinks(db, pageId);

    const row = db.prepare(
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
       FROM pages WHERE id = ?`,
    ).get(pageId) as DbRow | undefined;
    if (!row) {
      throw new Error('Could not load created page');
    }

    db.exec('COMMIT');
    inTransaction = false;
    return rowToPage(row);
  } catch (error) {
    if (inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.close();
  }
}

function normalizeSortKey(baseSort: number, index: number): number {
  return Number.parseFloat(`${baseSort}.${index + 1}`);
}

const PAGE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPageId(value: string): boolean {
  return PAGE_ID_REGEX.test(value);
}

function extractPageIdFromHref(href: string): string | null {
  try {
    const decoded = decodeURIComponent(href).trim();
    const match = /^\/?page\/(?<id>[0-9a-f-]+)$/i.exec(decoded);
    if (match?.groups?.id) {
      return isPageId(match.groups.id) ? match.groups.id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function collectMoveTargets(moves: PageMoveInput[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const move of moves) {
    map.set(move.id, move.parentId);
  }
  return map;
}

function wouldIntroduceCycle(
  candidateId: string,
  targetParentId: string | null,
  existingParents: Map<string, string | null>,
): boolean {
  let current = targetParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === candidateId) {
      return true;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = existingParents.get(current) ?? null;
  }
  return false;
}

function verifyTreeMove(
  move: PageMoveInput,
  allRows: DbRow[],
  moveTargetById: Map<string, string | null>,
) {
  const effectiveParents = new Map<string, string | null>(
    allRows.map((row) => [String(row.id), (row.parent_id as string | null) ?? null]),
  );

  for (const [id, parentId] of moveTargetById) {
    effectiveParents.set(id, parentId);
  }

  const candidateParent = moveTargetById.get(move.id) ?? move.parentId;

  if (candidateParent && !allRows.some((row) => String(row.id) === candidateParent && row.deleted_at == null)) {
    throw new Error(`Target parent not found: ${candidateParent}`);
  }

  if (wouldIntroduceCycle(move.id, candidateParent, effectiveParents)) {
    throw new Error('Move would create a cycle');
  }
}

export function applyPageMoves(moves: PageMoveInput[], dataDir?: string): PageRecord[] {
  if (moves.length === 0) {
    return [];
  }

  const db = createStorageConnection(dataDir);

  try {
    db.exec('BEGIN IMMEDIATE');
    const now = Date.now();
    const beforePages = getLivePageUrlPages(db);
    const allRows = db.prepare('SELECT id, parent_id, slug, title, deleted_at FROM pages').all() as DbRow[];
    const currentStmt = db.prepare('SELECT id, revision, deleted_at, slug, title, parent_id FROM pages WHERE id = ?');
    const moveTargetById = collectMoveTargets(moves);

    const updateStmt = db.prepare(
      `UPDATE pages
       SET parent_id = ?,
           slug = ?,
           sort_key = ?,
           revision = revision + 1,
           updated_at = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    );
    const updatedPageStmt = db.prepare(
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
       FROM pages WHERE id = ?`,
    );

    const updated: PageRecord[] = [];
    const seen = new Set<string>();
    const plannedPages = beforePages.map((page) => ({ ...page }));

    for (const move of moves) {
      if (seen.has(move.id)) {
        throw new Error(`Duplicate move id: ${move.id}`);
      }
      seen.add(move.id);

      const row = currentStmt.get(move.id) as DbRow | undefined;
      if (!row) {
        throw new Error(`Page not found: ${move.id}`);
      }
      if (row.deleted_at != null) {
        throw new Error(`Cannot move deleted page: ${move.id}`);
      }

      const currentRevision = Number(row.revision);
      if (currentRevision !== move.revision) {
        throw new RevisionConflictError(`Stale revision for page ${move.id}`);
      }

      verifyTreeMove(move, allRows, moveTargetById);
    }

    for (const move of moves) {
      const page = plannedPages.find((item) => item.id === move.id);
      if (!page) {
        throw new Error(`Page not found in plan: ${move.id}`);
      }
      page.parentId = move.parentId;
      page.slug = getUniqueSlugFromBase(page.slug, move.parentId, plannedPages, page.id);
      const result = updateStmt.run(move.parentId, page.slug, move.sortKey, now, move.id, move.revision);
      if (Number(result.changes) !== 1) {
        throw new RevisionConflictError(`Page changed while move was being applied: ${move.id}`);
      }
    }

    for (const move of moves) {
      const row = updatedPageStmt.get(move.id) as DbRow | undefined;
      if (row) {
        updated.push(rowToPage(row));
      }
    }

    syncPagePathAliases(db, beforePages, getLivePageUrlPages(db));

    db.exec('COMMIT');
    return updated;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

export function updatePage(id: string, input: PageUpdate, dataDir?: string): PageRecord {
  const db = createStorageConnection(dataDir);
  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const beforePages = getLivePageUrlPages(db);
    const current = db.prepare(
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
       FROM pages WHERE id = ? AND deleted_at IS NULL`,
    ).get(id) as DbRow | undefined;

    if (!current) {
      throw new Error('Page not found');
    }

    const currentPage = rowToPage(current);
    if (currentPage.revision !== input.revision) {
      throw new RevisionConflictError('Stale revision supplied', currentPage.revision);
    }

    const allRows = db.prepare('SELECT id, parent_id, slug, title, deleted_at FROM pages').all() as DbRow[];
    const allParentMap = new Map<string, string | null>(
      allRows.map((row) => [String(row.id), (row.parent_id as string | null) ?? null]),
    );

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const nextParentId = Object.hasOwn(input, 'parentId') ? input.parentId ?? null : currentPage.parentId;
    let nextSlug = currentPage.slug;

    if (Object.hasOwn(input, 'parentId')) {
      const parentId = input.parentId ?? null;
      if (parentId && !allRows.some((row) => String(row.id) === parentId && row.deleted_at == null)) {
        throw new Error('Target parent not found');
      }

      const candidate = new Map(allParentMap);
      candidate.set(id, parentId);
      if (wouldIntroduceCycle(id, parentId, candidate)) {
        throw new Error('Update would create a cycle');
      }

      fields.push('parent_id = ?');
      values.push(parentId);
    }
    if (input.sortKey !== undefined) {
      fields.push('sort_key = ?');
      values.push(input.sortKey);
    }
    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
      nextSlug = getUniquePageSlug(input.title, nextParentId, beforePages, id);
    } else if (Object.hasOwn(input, 'parentId')) {
      nextSlug = getUniqueSlugFromBase(currentPage.slug, nextParentId, beforePages, id);
    }
    if (nextSlug !== currentPage.slug) {
      fields.push('slug = ?');
      values.push(nextSlug);
    }
    if (Object.hasOwn(input, 'icon')) {
      fields.push('icon = ?');
      values.push(input.icon ?? null);
    }
    if (Object.hasOwn(input, 'iconAssetId')) {
      fields.push('icon_asset_id = ?');
      values.push(input.iconAssetId ?? null);
    }
    if (Object.hasOwn(input, 'coverAssetId')) {
      fields.push('cover_asset_id = ?');
      values.push(input.coverAssetId ?? null);
    }
    if (Object.hasOwn(input, 'coverFocalX')) {
      fields.push('cover_focal_x = ?');
      values.push(sanitizeFocal(input.coverFocalX, currentPage.coverFocalX));
    }
    if (Object.hasOwn(input, 'coverFocalY')) {
      fields.push('cover_focal_y = ?');
      values.push(sanitizeFocal(input.coverFocalY, currentPage.coverFocalY));
    }
    if (Object.hasOwn(input, 'coverScale')) {
      fields.push('cover_scale = ?');
      values.push(sanitizeCoverScale(input.coverScale, currentPage.coverScale));
    }
    if (input.contentJson !== undefined) {
      fields.push('content_json = ?');
      values.push(input.contentJson);
    }

    if (!fields.length) {
      db.exec('COMMIT');
      inTransaction = false;
      return currentPage;
    }

    fields.push('revision = revision + 1', 'updated_at = ?');
    values.push(Date.now(), id, input.revision);
    const result = db.prepare(
      `UPDATE pages SET ${fields.join(', ')} WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    ).run(...values);
    if (Number(result.changes) !== 1) {
      const latest = db.prepare('SELECT revision FROM pages WHERE id = ?').get(id) as DbRow | undefined;
      throw new RevisionConflictError('Page changed while the update was being saved', latest ? Number(latest.revision) : undefined);
    }

    rebuildBacklinks(db, id);
    const updated = db.prepare(
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
       FROM pages WHERE id = ?`,
    ).get(id) as DbRow | undefined;
    if (!updated) {
      throw new Error('Could not load updated page');
    }

    syncPagePathAliases(db, beforePages, getLivePageUrlPages(db));

    db.exec('COMMIT');
    inTransaction = false;
    return rowToPage(updated);
  } catch (error) {
    if (inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.close();
  }
}

export function trashPage(id: string, dataDir?: string): void {
  const db = createStorageConnection(dataDir);
  try {
    const now = Date.now();
    db.prepare('UPDATE pages SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?').run(now, now, id);
  } finally {
    db.close();
  }
}

export function restorePage(id: string, dataDir?: string): PageRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const now = Date.now();
    db.prepare('UPDATE pages SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?').run(now, id);
    return getPage(id, dataDir);
  } finally {
    db.close();
  }
}

export function duplicatePage(id: string, dataDir?: string): PageRecord | null {
  const source = getPage(id, dataDir);
  if (!source) {
    return null;
  }
  return createPage(
    {
      parentId: source.parentId,
      title: `${source.title} Copy`,
      icon: source.icon,
      iconAssetId: source.iconAssetId,
      coverAssetId: source.coverAssetId,
      coverFocalX: source.coverFocalX,
      coverFocalY: source.coverFocalY,
      coverScale: source.coverScale,
      contentJson: source.contentJson,
      sortKey: normalizeSortKey(source.sortKey, 1),
    },
    dataDir,
  );
}

export function searchPageSummaries(query: string, dataDir?: string, includeCollectionPages = true): PageSummaryRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL AND title LIKE ?${collectionMembershipFilterClause(includeCollectionPages)}
         ORDER BY updated_at DESC`,
      )
      .all(pattern) as DbRow[];
    return rows.map(rowToPageSummary);
  } finally {
    db.close();
  }
}

export function searchPages(query: string, dataDir?: string, includeCollectionPages = true): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL AND title LIKE ?${collectionMembershipFilterClause(includeCollectionPages)}
         ORDER BY updated_at DESC`,
      )
      .all(pattern) as DbRow[];
    return rows.map(rowToPage);
  } finally {
    db.close();
  }
}

export function listAssets(dataDir?: string): AssetRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, filename, mime_type, sha256, size, width, height, created_at
         FROM assets
         ORDER BY created_at DESC`,
      )
      .all() as DbRow[];
    return rows.map(rowToAsset);
  } finally {
    db.close();
  }
}

export function getAsset(id: string, dataDir?: string): AssetRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare(
        `SELECT id, filename, mime_type, sha256, size, width, height, created_at
         FROM assets
         WHERE id = ?`,
      )
      .get(id) as DbRow | undefined;
    return row ? rowToAsset(row) : null;
  } finally {
    db.close();
  }
}

function getAssetBySha256(hash: string, db: DatabaseSync): AssetRecord | null {
  const row = db
    .prepare(
      `SELECT id, filename, mime_type, sha256, size, width, height, created_at
       FROM assets
       WHERE sha256 = ?`,
    )
    .get(hash) as DbRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function getAssetPathFromId(assetId: string, dataDir?: string): string {
  const asset = getAsset(assetId, dataDir);
  if (!asset) {
    return '';
  }
  const ext = path.extname(asset.filename);
  return path.join(getWorkspaceAssetsDir(dataDir), `${asset.id}${ext}`);
}

export function createAsset(
  options: {
    filename: string;
    mimeType: string;
    sourcePath: string;
    width?: number | null;
    height?: number | null;
  },
  dataDir?: string,
): AssetCreateResult {
  const db = createStorageConnection(dataDir);
  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const assetDir = getWorkspaceAssetsDir(dataDir);
    mkdirSync(assetDir, { recursive: true });

    const sourceData = readFileSync(options.sourcePath);
    const hash = createHash('sha256').update(sourceData).digest('hex');
    const existing = getAssetBySha256(hash, db);
    if (existing) {
      db.exec('COMMIT');
      inTransaction = false;
      return { asset: existing, created: false };
    }

    const filename = sanitizeFilename(options.filename);
    const ext = path.extname(filename);
    const id = hash;
    const targetPath = path.join(assetDir, `${id}${ext}`);
    const now = Date.now();

    copyFileSync(options.sourcePath, targetPath);
    db.prepare(
      `INSERT INTO assets (id, filename, mime_type, sha256, size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      filename,
      options.mimeType,
      hash,
      sourceData.length,
      options.width ?? null,
      options.height ?? null,
      now,
    );

    const result = {
      asset: {
        id,
        filename,
        mimeType: options.mimeType,
        sha256: hash,
        size: sourceData.length,
        width: options.width ?? null,
        height: options.height ?? null,
        createdAt: now,
      },
      created: true,
    };
    db.exec('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.close();
  }
}

const DEFAULT_COLLECTION_SCHEMA: CollectionSchema = {
  properties: [],
};

const DEFAULT_COLLECTION_VIEWS: CollectionViews = {
  mode: 'table',
};

const BOOKS_COLLECTION_SCHEMA: CollectionSchema = {
  properties: [
    { id: 'author', name: 'Author', type: 'select' },
    { id: 'status', name: 'Status', type: 'select', options: ['To read', 'Reading', 'Finished'] },
    { id: 'type', name: 'Type', type: 'multi-select' },
    { id: 'score', name: 'Score /5', type: 'number' },
    { id: 'tags', name: 'Tags', type: 'multi-select' },
  ],
};

function isBooksCollectionName(name: string): boolean {
  return name.toLowerCase().includes('book');
}

function normalizeCollectionSchema(input: unknown): CollectionSchema {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_COLLECTION_SCHEMA };
  }

  const candidate = input as Partial<CollectionSchema>;
  if (!Array.isArray(candidate.properties)) {
    return { ...DEFAULT_COLLECTION_SCHEMA };
  }

  const properties = candidate.properties
    .map((property) => {
      if (!property || typeof property !== 'object') {
        return null;
      }

      const candidateProperty = property as {
        id?: unknown;
        name?: unknown;
        type?: unknown;
        options?: unknown;
        optionColors?: unknown;
      };

      if (typeof candidateProperty.id !== 'string' || typeof candidateProperty.name !== 'string') {
        return null;
      }

      const type = candidateProperty.type;
      const parsedType =
        type === 'text' ||
        type === 'number' ||
        type === 'select' ||
        type === 'multi-select' ||
        type === 'checkbox' ||
        type === 'date' ||
        type === 'url'
          ? type
          : 'text';

      const options =
        parsedType === 'select' || parsedType === 'multi-select'
          ? Array.from(new Set(
              Array.isArray(candidateProperty.options)
                ? candidateProperty.options
                    .map((option) => (typeof option === 'string' ? option.trim() : ''))
                    .filter(Boolean)
                : [],
            ))
          : undefined;
      const optionSet = new Set(options ?? []);
      const optionColors = candidateProperty.optionColors && typeof candidateProperty.optionColors === 'object'
        ? Object.entries(candidateProperty.optionColors as Record<string, unknown>).reduce<Record<string, 'accent' | 'success' | 'warning' | 'danger'>>((next, [option, color]) => {
            if (optionSet.has(option) && (color === 'accent' || color === 'success' || color === 'warning' || color === 'danger')) {
              next[option] = color;
            }
            return next;
          }, {})
        : undefined;

      return {
        id: candidateProperty.id,
        name: candidateProperty.name.trim() || 'Property',
        type: parsedType,
        options,
        optionColors: optionColors && Object.keys(optionColors).length ? optionColors : undefined,
      };
    })
    .filter(Boolean) as CollectionSchema['properties'];

  return {
    properties,
  };
}

function normalizeCollectionViews(input: unknown): CollectionViews {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_COLLECTION_VIEWS };
  }

  const candidate = input as Partial<CollectionViews>;
  const mode = candidate.mode === 'gallery' ? 'gallery' : 'table';
  const sort =
    candidate.sort &&
    candidate.sort.propertyId &&
    typeof candidate.sort.propertyId === 'string' &&
    (candidate.sort.direction === 'asc' || candidate.sort.direction === 'desc')
      ? {
          propertyId: candidate.sort.propertyId,
          direction: candidate.sort.direction,
        }
      : undefined;

  const filter =
    candidate.filter &&
    typeof candidate.filter === 'object' &&
    typeof candidate.filter.propertyId === 'string' &&
    typeof candidate.filter.query === 'string' &&
    candidate.filter.propertyId.trim().length > 0
      ? {
          propertyId: candidate.filter.propertyId,
          query: candidate.filter.query,
        }
      : undefined;

  return {
    mode,
    sort,
    filter,
  };
}

export function listCollections(dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, host_page_id, name, schema_json, views_json, created_at, updated_at
         FROM collections
         ORDER BY updated_at DESC`,
      )
      .all() as DbRow[];
    return rows.map(rowToCollection);
  } finally {
    db.close();
  }
}

export function listCollectionsHostedByPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, host_page_id, name, schema_json, views_json, created_at, updated_at
         FROM collections
         WHERE host_page_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(pageId) as DbRow[];
    return rows.map(rowToCollection);
  } finally {
    db.close();
  }
}

export function listCollectionsForPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT c.id, c.host_page_id, c.name, c.schema_json, c.views_json, c.created_at, c.updated_at
         FROM collections c
         JOIN collection_items ci ON ci.collection_id = c.id
         WHERE ci.page_id = ?
         ORDER BY c.updated_at DESC`,
      )
      .all(pageId) as DbRow[];
    return rows.map(rowToCollection);
  } finally {
    db.close();
  }
}

export function listCollectionPages(dataDir?: string): CollectionRecord[] {
  return listCollections(dataDir);
}

export function getCollection(collectionId: string, dataDir?: string): CollectionRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare(
        `SELECT id, host_page_id, name, schema_json, views_json, created_at, updated_at
         FROM collections
         WHERE id = ?`,
      )
      .get(collectionId) as DbRow | undefined;
    return row ? rowToCollection(row) : null;
  } finally {
    db.close();
  }
}

export function createCollection(
  input: {
    name: string;
    hostPageId?: string | null;
    schema?: CollectionSchema;
    views?: CollectionViews;
  },
  dataDir?: string,
): CollectionRecord {
  const name = input.name?.trim();
  if (!name) {
    throw new Error('Collection name is required');
  }

  const db = createStorageConnection(dataDir);
  const id = randomUUID();
  const now = Date.now();

  try {
    if (input.hostPageId) {
      const host = db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(input.hostPageId);
      if (!host) {
        throw new Error('Collection host page not found');
      }
    }

    const normalizedSchema = normalizeCollectionSchema(input.schema);
    const schema = isBooksCollectionName(name) && normalizedSchema.properties.length === 0 ? BOOKS_COLLECTION_SCHEMA : normalizedSchema;
    const views = normalizeCollectionViews(input.views);

    db.prepare(
      `INSERT INTO collections (id, host_page_id, name, schema_json, views_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.hostPageId ?? null,
      name,
      JSON.stringify(schema),
      JSON.stringify(views),
      now,
      now,
    );

    const row = db.prepare(
      `SELECT id, host_page_id, name, schema_json, views_json, created_at, updated_at
       FROM collections WHERE id = ?`,
    ).get(id) as DbRow | undefined;
    if (!row) {
      throw new Error('Could not load created collection');
    }
    return rowToCollection(row);
  } finally {
    db.close();
  }
}

export function updateCollection(
  collectionId: string,
  updates: {
    name?: string;
    hostPageId?: string | null;
    schema?: CollectionSchema;
    views?: CollectionViews;
  },
  dataDir?: string,
): CollectionRecord {
  const db = createStorageConnection(dataDir);
  try {
    const current = getCollection(collectionId, dataDir);
    if (!current) {
      throw new Error('Collection not found');
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) {
        throw new Error('Collection name is required');
      }
      fields.push('name = ?');
      values.push(name);
    }
    if (Object.hasOwn(updates, 'hostPageId')) {
      const hostPageId = updates.hostPageId ?? null;
      if (hostPageId) {
        const host = db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(hostPageId);
        if (!host) {
          throw new Error('Collection host page not found');
        }
      }
      fields.push('host_page_id = ?');
      values.push(hostPageId);
    }
    if (Object.hasOwn(updates, 'schema')) {
      fields.push('schema_json = ?');
      values.push(JSON.stringify(normalizeCollectionSchema(updates.schema)));
    }
    if (Object.hasOwn(updates, 'views')) {
      fields.push('views_json = ?');
      values.push(JSON.stringify(normalizeCollectionViews(updates.views)));
    }

    if (!fields.length) {
      return current;
    }

    fields.push('updated_at = ?');
    values.push(String(Date.now()));

    db.prepare(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`).run(...values, collectionId);

    const updated = getCollection(collectionId, dataDir);
    if (!updated) {
      throw new Error('Could not load updated collection');
    }
    return updated;
  } finally {
    db.close();
  }
}

export function deleteCollection(collectionId: string, dataDir?: string): void {
  const db = createStorageConnection(dataDir);
  try {
    db.prepare('DELETE FROM collections WHERE id = ?').run(collectionId);
  } finally {
    db.close();
  }
}

export function listCollectionItems(collectionId: string, dataDir?: string): CollectionItemRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT collection_id, page_id, properties_json, sort_key
         FROM collection_items
         WHERE collection_id = ?
         ORDER BY sort_key ASC`,
      )
      .all(collectionId) as DbRow[];
    return rows.map((row) => ({
      collectionId: String(row.collection_id),
      pageId: String(row.page_id),
      propertiesJson: String(row.properties_json),
      sortKey: Number(row.sort_key),
    }));
  } finally {
    db.close();
  }
}

function getCollectionItem(collectionId: string, pageId: string, db: DatabaseSync): CollectionItemRecord | null {
  const row = db
    .prepare(
      `SELECT collection_id, page_id, properties_json, sort_key
       FROM collection_items
       WHERE collection_id = ? AND page_id = ?`,
    )
    .get(collectionId, pageId) as DbRow | undefined;

  if (!row) {
    return null;
  }

  return {
    collectionId: String(row.collection_id),
    pageId: String(row.page_id),
    propertiesJson: String(row.properties_json),
    sortKey: Number(row.sort_key),
  };
}

export function createCollectionItem(input: CollectionItemPayload, dataDir?: string): CollectionItemRecord {
  const db = createStorageConnection(dataDir);

  try {
    const collection = getCollection(input.collectionId, dataDir);
    if (!collection) {
      throw new Error('Collection not found');
    }

    const page = getPage(input.pageId, dataDir);
    if (!page || page.deletedAt !== null) {
      throw new Error('Page not found');
    }

    if (getCollectionItem(input.collectionId, input.pageId, db)) {
      throw new Error('Page is already in collection');
    }

    const maxResult = db
      .prepare('SELECT MAX(sort_key) as maxSort FROM collection_items WHERE collection_id = ?')
      .get(input.collectionId) as DbRow | undefined;
    const baseSort = typeof maxResult?.maxSort === 'number' ? Number(maxResult.maxSort) : 0;
    const sortKey = input.sortKey !== undefined ? input.sortKey : baseSort + 1;

    const propertiesJson = JSON.stringify(input.properties ?? {});
    db.prepare(
      `INSERT INTO collection_items (collection_id, page_id, properties_json, sort_key)
       VALUES (?, ?, ?, ?)`,
    ).run(input.collectionId, input.pageId, propertiesJson, sortKey);

    return {
      collectionId: input.collectionId,
      pageId: input.pageId,
      propertiesJson,
      sortKey,
    };
  } finally {
    db.close();
  }
}

export function updateCollectionItemProperties(input: CollectionPropertiesPatch, dataDir?: string): CollectionItemRecord {
  const db = createStorageConnection(dataDir);

  try {
    const item = getCollectionItem(input.collectionId, input.pageId, db);
    if (!item) {
      throw new Error('Collection item not found');
    }

    const currentProperties = parseCollectionItemProperties(item.propertiesJson);
    const merged = {
      ...currentProperties,
      ...input.properties,
    } as Record<string, unknown>;

    const propertiesJson = JSON.stringify(merged);
    db.prepare(
      `UPDATE collection_items
       SET properties_json = ?
       WHERE collection_id = ? AND page_id = ?`,
    ).run(propertiesJson, input.collectionId, input.pageId);

    return {
      ...item,
      propertiesJson,
    };
  } finally {
    db.close();
  }
}

function parseCollectionItemProperties(rawProperties: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawProperties) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failure
  }
  return {};
}

export function applyCollectionItemMoves(moves: CollectionUpdateItemSort[], dataDir?: string): CollectionItemRecord[] {
  if (!moves.length) {
    return [];
  }

  const db = createStorageConnection(dataDir);

  try {
    db.exec('BEGIN');

    const updateStmt = db.prepare(`UPDATE collection_items SET sort_key = ? WHERE collection_id = ? AND page_id = ?`);

    const updated: CollectionItemRecord[] = [];
    const seen = new Set<string>();

    for (const move of moves) {
      const key = `${move.collectionId}::${move.pageId}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate collection move: ${move.collectionId}/${move.pageId}`);
      }
      seen.add(key);

      if (!Number.isFinite(move.sortKey)) {
        throw new Error('sortKey must be a number');
      }

      const item = getCollectionItem(move.collectionId, move.pageId, db);
      if (!item) {
        throw new Error(`Collection item not found: ${move.collectionId}/${move.pageId}`);
      }
      updateStmt.run(move.sortKey, move.collectionId, move.pageId);
      updated.push({
        ...item,
        sortKey: move.sortKey,
      });
    }

    db.exec('COMMIT');
    return updated;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

export function removeCollectionItem(collectionId: string, pageId: string, dataDir?: string): void {
  const db = createStorageConnection(dataDir);
  try {
    db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND page_id = ?').run(collectionId, pageId);
  } finally {
    db.close();
  }
}

export function getSettings(dataDir?: string): { schemaVersion: number; workspaceName: string; publishedMode: boolean } {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare('SELECT schema_version, workspace_name, published_mode FROM settings ORDER BY schema_version DESC LIMIT 1')
      .get() as DbRow | undefined;
    if (!row) {
      const now = Date.now();
      db.prepare(
        'INSERT INTO settings (schema_version, workspace_name, published_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', 0, now, now);
      return { schemaVersion: CURRENT_SCHEMA_VERSION, workspaceName: 'Arcane Codex', publishedMode: false };
    }
    return {
      schemaVersion: Number(row.schema_version),
      workspaceName: String(row.workspace_name),
      publishedMode: Boolean(Number(row.published_mode ?? 0)),
    };
  } finally {
    db.close();
  }
}

export function updateSettings(dataDir: string | undefined, updates: { workspaceName?: string; publishedMode?: boolean }): { schemaVersion: number; workspaceName: string; publishedMode: boolean } {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare('SELECT schema_version FROM settings ORDER BY schema_version DESC LIMIT 1')
      .get() as DbRow | undefined;
    const now = Date.now();
    const workspaceName = typeof updates.workspaceName === 'string' && updates.workspaceName.trim() ? updates.workspaceName.trim() : undefined;
    const publishedMode = typeof updates.publishedMode === 'boolean' ? updates.publishedMode : undefined;

    if (!row) {
      db.prepare(
        'INSERT INTO settings (schema_version, workspace_name, published_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(CURRENT_SCHEMA_VERSION, workspaceName ?? 'Arcane Codex', publishedMode ? 1 : 0, now, now);
      return getSettings(dataDir);
    }

    const assignments: string[] = [];
    const values: Array<string | number> = [];
    if (workspaceName !== undefined) {
      assignments.push('workspace_name = ?');
      values.push(workspaceName);
    }
    if (publishedMode !== undefined) {
      assignments.push('published_mode = ?');
      values.push(publishedMode ? 1 : 0);
    }
    assignments.push('updated_at = ?');
    values.push(now);
    db.prepare(`UPDATE settings SET ${assignments.join(', ')}`).run(...values);
    return getSettings(dataDir);
  } finally {
    db.close();
  }
}

export function rebuildBacklinks(db: DatabaseSync, pageId: string): void {
  db.prepare('DELETE FROM page_links WHERE source_page_id = ?').run(pageId);
  const row = db.prepare('SELECT content_json FROM pages WHERE id = ?').get(pageId) as DbRow | undefined;
  if (!row?.content_json) {
    return;
  }

  const ids = extractLinkedPageIds(String(row.content_json));
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO page_links (source_page_id, source_block_id, target_page_id) VALUES (?, ?, ?)',
  );

  const targetExists = db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL');
  for (const [index, linkedId] of ids.entries()) {
    if (!targetExists.get(linkedId)) {
      continue;
    }
    const blockId = createHash('sha256').update(`${pageId}:${linkedId}:${index}`).digest('hex').slice(0, 16);
    stmt.run(pageId, blockId, linkedId);
  }
}

export function readBacklinks(targetPageId: string, dataDir?: string): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT p.id, p.parent_id, p.sort_key, p.slug, p.title, p.icon, p.icon_asset_id, p.cover_asset_id, p.cover_focal_x, p.cover_focal_y, p.cover_scale, p.content_json, p.revision, p.created_at, p.updated_at, p.deleted_at
         FROM page_links l
         JOIN pages p ON p.id = l.source_page_id
         WHERE l.target_page_id = ? AND p.deleted_at IS NULL
         ORDER BY p.updated_at DESC`,
      )
      .all(targetPageId) as DbRow[];
    return rows.map(rowToPage);
  } finally {
    db.close();
  }
}

export function extractLinkedPageIds(contentJson: string): string[] {
  if (!contentJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(contentJson) as unknown;
    const ids = new Set<string>();

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') {
        return;
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }
        return;
      }

      const obj = node as Record<string, unknown>;

      if (obj.type === 'pageLink' || obj.type === 'pageCard') {
        const props = obj.props as Record<string, unknown> | undefined;
        const explicit = props?.pageId;
        if (typeof explicit === 'string' && isPageId(explicit)) {
          ids.add(explicit);
        }
      }

      if (obj.type === 'link' && typeof obj.href === 'string') {
        const linkTarget = extractPageIdFromHref(obj.href);
        if (linkTarget) {
          ids.add(linkTarget);
        }
      }

      if (typeof obj.pageId === 'string' && isPageId(obj.pageId)) {
        ids.add(obj.pageId);
      }
      if (typeof obj.targetPageId === 'string' && isPageId(obj.targetPageId)) {
        ids.add(obj.targetPageId);
      }

      for (const key of ['children', 'content', 'text', 'props']) {
        if (obj[key] !== undefined) {
          walk(obj[key]);
        }
      }
    };

    walk(parsed);
    return [...ids];
  } catch {
    return [];
  }
}
