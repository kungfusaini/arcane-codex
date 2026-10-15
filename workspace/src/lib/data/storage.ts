import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import {
  AssetRecord,
  CollectionItemPayload,
  CollectionItemRecord,
  CollectionOptionColor,
  CollectionPropertiesPatch,
  CollectionPropertyType,
  CollectionRecord,
  CollectionSchema,
  CollectionUpdateItemSort,
  CollectionViewRecord,
  CollectionViews,
  PageCollectionViewRecord,
  NewPage,
  PageMoveInput,
  PageKind,
  PagePublicationRecord,
  PageRecord,
  PageUpdate,
  PublicationVisibility,
  PublishedPageRecord,
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
import { ICON_VARIANT_DIR } from './assetDerivatives';
import { normalizeMarkdownExtensions, pageIdsFromMarkdown, validateMarkdown } from '../documents/markdown';

const CURRENT_SCHEMA_VERSION = 14;

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
    const versionRow = db.prepare('PRAGMA user_version;').get() as DbRow;
    const version = Number(versionRow.user_version ?? 0);
    if (version > 0 && version < 12) {
      throw new WorkspaceIntegrityError(
        `Workspace schema version ${version} predates the normalized collection model. Run the one-time offline migration with the previous Arcane Codex build before opening it here.`,
      );
    }
    if (version === 12) {
      const backupPath = `${dbPath}.pre-publications-v12`;
      if (!existsSync(backupPath)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        copyFileSync(dbPath, backupPath);
      }
    }
    const pageColumns = version > 0 ? db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }> : [];
    const needsContentKindMigration = version > 0 && !pageColumns.some((column) => column.name === 'kind');
    if (version === 13 || needsContentKindMigration) {
      const backupPath = `${dbPath}.pre-content-kinds-v13`;
      if (!existsSync(backupPath)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        copyFileSync(dbPath, backupPath);
      }
    }
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
        'INSERT INTO settings (schema_version, workspace_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', now, now);
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
        kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('page', 'note', 'article', 'project', 'fiction')),
        summary TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        body_markdown TEXT NOT NULL DEFAULT '',
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

      CREATE TABLE IF NOT EXISTS page_publications (
        page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
        source_revision INTEGER,
        parent_id TEXT,
        sort_key REAL,
        slug TEXT,
        title TEXT,
        icon TEXT,
        icon_asset_id TEXT,
        cover_asset_id TEXT,
        cover_focal_x REAL,
        cover_focal_y REAL,
        cover_scale REAL,
        kind TEXT,
        summary TEXT,
        tags_json TEXT,
        body_markdown TEXT,
        source_created_at INTEGER,
        source_updated_at INTEGER,
        published_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_page_publications_visibility ON page_publications(visibility, parent_id, sort_key);

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        prompt TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS collection_properties (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'number', 'select', 'multi-select', 'checkbox', 'date', 'url')),
        position REAL NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (collection_id, key)
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        sort_key REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, page_id)
      );

      CREATE TABLE IF NOT EXISTS collection_values (
        collection_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        property_id TEXT NOT NULL REFERENCES collection_properties(id) ON DELETE CASCADE,
        value_json TEXT NOT NULL,
        PRIMARY KEY (collection_id, page_id, property_id),
        FOREIGN KEY (collection_id, page_id) REFERENCES collection_items(collection_id, page_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS collection_views (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('table', 'gallery')),
        config_json TEXT NOT NULL DEFAULT '{}',
        position REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_collection_views (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        view_id TEXT NOT NULL REFERENCES collection_views(id) ON DELETE CASCADE,
        sort_key REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (page_id, view_id)
      );

      CREATE TABLE IF NOT EXISTS published_page_collection_views (
        page_id TEXT NOT NULL REFERENCES page_publications(page_id) ON DELETE CASCADE,
        view_id TEXT NOT NULL REFERENCES collection_views(id) ON DELETE CASCADE,
        sort_key REAL NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (page_id, view_id)
      );

      CREATE TABLE IF NOT EXISTS page_path_aliases (
        alias_path TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        schema_version INTEGER NOT NULL,
        workspace_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (schema_version)
      );

      CREATE INDEX IF NOT EXISTS idx_pages_parent_sort ON pages(parent_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(deleted_at, parent_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_collection_items_sort ON collection_items(collection_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_collection_properties_order ON collection_properties(collection_id, position);
      CREATE INDEX IF NOT EXISTS idx_collection_views_order ON collection_views(collection_id, position);
      CREATE INDEX IF NOT EXISTS idx_page_collection_views_page ON page_collection_views(page_id, sort_key);
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
    db.exec('PRAGMA user_version = 7;');
  }

  if (currentVersion < 8) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'kind') && !pageColumns.some((column) => column.name === 'is_article')) {
      db.exec("ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';");
    }
    db.exec('PRAGMA user_version = 8;');
  }

  if (currentVersion < 9) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'tags_json')) {
      db.exec("ALTER TABLE pages ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';");
    }
    db.exec('PRAGMA user_version = 9;');
  }

  if (currentVersion < 10) {
    const assetColumns = db.prepare('PRAGMA table_info(assets);').all() as Array<{ name: string }>;
    if (!assetColumns.some((column) => column.name === 'prompt')) {
      db.exec('ALTER TABLE assets ADD COLUMN prompt TEXT;');
    }
    db.exec('PRAGMA user_version = 10;');
  }

  if (currentVersion < 11) {
    const pageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!pageColumns.some((column) => column.name === 'body_markdown')) {
      db.exec("ALTER TABLE pages ADD COLUMN body_markdown TEXT NOT NULL DEFAULT '';");
    }
    db.exec('PRAGMA user_version = 11;');
  }

  if (currentVersion > 0 && currentVersion < 13) {
    db.exec(`
      CREATE TABLE page_publications (
        page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
        source_revision INTEGER,
        parent_id TEXT,
        sort_key REAL,
        slug TEXT,
        title TEXT,
        icon TEXT,
        icon_asset_id TEXT,
        cover_asset_id TEXT,
        cover_focal_x REAL,
        cover_focal_y REAL,
        cover_scale REAL,
        kind TEXT,
        summary TEXT,
        tags_json TEXT,
        body_markdown TEXT,
        source_created_at INTEGER,
        source_updated_at INTEGER,
        published_at INTEGER
      );
      CREATE INDEX idx_page_publications_visibility ON page_publications(visibility, parent_id, sort_key);
      CREATE TABLE published_page_collection_views (
        page_id TEXT NOT NULL REFERENCES page_publications(page_id) ON DELETE CASCADE,
        view_id TEXT NOT NULL REFERENCES collection_views(id) ON DELETE CASCADE,
        sort_key REAL NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (page_id, view_id)
      );
      INSERT INTO page_publications (page_id, visibility) SELECT id, 'private' FROM pages;
      CREATE TABLE settings_v13 (
        schema_version INTEGER NOT NULL PRIMARY KEY,
        workspace_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO settings_v13 (schema_version, workspace_name, created_at, updated_at)
        SELECT 13, workspace_name, created_at, updated_at FROM settings ORDER BY schema_version DESC LIMIT 1;
      DROP TABLE settings;
      ALTER TABLE settings_v13 RENAME TO settings;
      PRAGMA user_version = 13;
    `);
  }

  const contentKindColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
  if (currentVersion < 14 || !contentKindColumns.some((column) => column.name === 'kind')) {
    const pageColumns = contentKindColumns;
    if (pageColumns.some((column) => column.name === 'is_article')) {
      db.exec('ALTER TABLE pages RENAME COLUMN is_article TO kind;');
      db.exec("UPDATE pages SET kind = CASE WHEN CAST(kind AS INTEGER) = 1 THEN 'article' ELSE 'note' END;");
    }
    const migratedPageColumns = db.prepare('PRAGMA table_info(pages);').all() as Array<{ name: string }>;
    if (!migratedPageColumns.some((column) => column.name === 'summary')) {
      db.exec("ALTER TABLE pages ADD COLUMN summary TEXT NOT NULL DEFAULT '';");
    }
    db.exec(`
      UPDATE pages SET kind = 'page'
      WHERE kind = 'note' AND (
        EXISTS (SELECT 1 FROM pages child WHERE child.parent_id = pages.id AND child.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM page_collection_views pcv WHERE pcv.page_id = pages.id)
      );
      UPDATE pages SET kind = 'project'
      WHERE id IN (
        SELECT ci.page_id FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
        WHERE lower(c.name) = 'projects' AND c.deleted_at IS NULL
      );
    `);

    const publicationColumns = db.prepare('PRAGMA table_info(page_publications);').all() as Array<{ name: string }>;
    if (publicationColumns.some((column) => column.name === 'is_article')) {
      db.exec('ALTER TABLE page_publications RENAME COLUMN is_article TO kind;');
      db.exec("UPDATE page_publications SET kind = CASE WHEN CAST(kind AS INTEGER) = 1 THEN 'article' WHEN kind IS NULL THEN NULL ELSE 'note' END;");
    }
    const migratedPublicationColumns = db.prepare('PRAGMA table_info(page_publications);').all() as Array<{ name: string }>;
    if (!migratedPublicationColumns.some((column) => column.name === 'summary')) {
      db.exec('ALTER TABLE page_publications ADD COLUMN summary TEXT;');
    }
    db.exec("UPDATE page_publications SET kind = (SELECT pages.kind FROM pages WHERE pages.id = page_publications.page_id) WHERE source_revision IS NOT NULL;");
    db.exec('PRAGMA user_version = 14;');
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
      if (filename === ICON_VARIANT_DIR) {
        continue;
      }
      if (!expectedFiles.has(filename)) {
        issues.push(`Unregistered file is present in the assets directory: ${filename}.`);
        recovery.add('Keep unregistered files until you confirm they are not needed, then move them out of the workspace.');
      }
    }

    const pages = db.prepare('SELECT id, body_markdown FROM pages ORDER BY id').all() as DbRow[];
    for (const page of pages) {
      const markdownIssues = typeof page.body_markdown === 'string' ? validateMarkdown(page.body_markdown) : ['Body is not text.'];
      if (markdownIssues.length) {
        issues.push(`Page ${String(page.id)} has invalid Markdown content: ${markdownIssues.join(' ')}`);
        recovery.add('Restore the page from backup or repair its Arcane Markdown extension markers.');
      }
    }

    const propertyConfigs = db.prepare('SELECT id, config_json FROM collection_properties ORDER BY id').all() as DbRow[];
    const viewConfigs = db.prepare('SELECT id, config_json FROM collection_views ORDER BY id').all() as DbRow[];
    for (const entry of [...propertyConfigs, ...viewConfigs]) {
      if (!hasValidJson(entry.config_json)) {
        issues.push(`Collection definition ${String(entry.id)} has invalid configuration JSON.`);
        recovery.add('Export collection CSV data before repairing the collection definition.');
      }
    }

    const values = db.prepare('SELECT collection_id, page_id, value_json FROM collection_values ORDER BY collection_id, page_id').all() as DbRow[];
    for (const value of values) {
      if (!hasValidJson(value.value_json)) {
        issues.push(`Collection value ${String(value.collection_id)}/${String(value.page_id)} has invalid JSON.`);
        recovery.add('Export collection CSV data before repairing collection values.');
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

function normalizePageTags(value: unknown): string[] {
  const tags = typeof value === 'string'
    ? (() => {
        try {
          const parsed = JSON.parse(value) as unknown;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : Array.isArray(value)
      ? value
      : [];

  return [...new Set(
    tags
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter(Boolean),
  )].slice(0, 20);
}

function normalizePageKind(value: unknown): PageKind {
  return value === 'page' || value === 'article' || value === 'project' || value === 'fiction' ? value : 'note';
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
    kind: normalizePageKind(row.kind),
    summary: String(row.summary ?? ''),
    tags: normalizePageTags(row.tags_json),
    bodyMarkdown: String(row.body_markdown),
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

export function registerPagePathAlias(aliasPath: string, pageId: string, dataDir?: string): void {
  const normalizedAlias = aliasPath.trim().replace(/^\/+|\/+$/g, '');
  if (!normalizedAlias) {
    throw new Error('Alias path is required');
  }

  const db = createStorageConnection(dataDir);
  try {
    const page = db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId);
    if (!page) {
      throw new Error(`Alias target page not found: ${pageId}`);
    }
    db.prepare(
      'INSERT OR REPLACE INTO page_path_aliases (alias_path, page_id, created_at) VALUES (?, ?, ?)',
    ).run(normalizedAlias, pageId, Date.now());
  } finally {
    db.close();
  }
}

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
    prompt: (row.prompt as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

function rowToCollection(row: DbRow, db: DatabaseSync): CollectionRecord {
  const id = String(row.id);
  const properties = (db.prepare(
    'SELECT key, name, type, config_json FROM collection_properties WHERE collection_id = ? ORDER BY position ASC',
  ).all(id) as DbRow[]).map((property) => {
    let config: { options?: string[]; optionColors?: Record<string, CollectionOptionColor> } = {};
    try { config = JSON.parse(String(property.config_json)) as typeof config; } catch { /* invalid config degrades to defaults */ }
    return {
      id: String(property.key),
      name: String(property.name),
      type: String(property.type) as CollectionPropertyType,
      ...(Array.isArray(config.options) ? { options: config.options } : {}),
      ...(config.optionColors && typeof config.optionColors === 'object' ? { optionColors: config.optionColors } : {}),
    };
  });
  const view = db.prepare(
    'SELECT id, mode, config_json FROM collection_views WHERE collection_id = ? ORDER BY position ASC LIMIT 1',
  ).get(id) as DbRow | undefined;
  let viewConfig: Omit<CollectionViews, 'mode'> = {};
  try { viewConfig = view ? JSON.parse(String(view.config_json)) as Omit<CollectionViews, 'mode'> : {}; } catch { /* invalid config degrades to defaults */ }
  const host = view ? db.prepare(
    'SELECT page_id FROM page_collection_views WHERE view_id = ? ORDER BY sort_key ASC LIMIT 1',
  ).get(String(view.id)) as DbRow | undefined : undefined;
  return {
    id,
    embedPageId: host ? String(host.page_id) : null,
    name: String(row.name),
    schema: { properties },
    view: { mode: view?.mode === 'gallery' ? 'gallery' : 'table', ...viewConfig },
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export type PageSummaryRecord = Omit<PageRecord, 'bodyMarkdown'>;

function rowToPageSummary(row: DbRow): PageSummaryRecord {
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
    kind: normalizePageKind(row.kind),
    summary: String(row.summary ?? ''),
    tags: normalizePageTags(row.tags_json),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

function collectionMembershipFilterClause(includeCollectionPages: boolean): string {
  return includeCollectionPages ? '' : ' AND id NOT IN (SELECT page_id FROM collection_items)';
}

export function listPageSummaries(dataDir?: string, includeCollectionPages = true): PageSummaryRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE id = ?`,
      )
      .get(id) as DbRow | undefined;
    return row ? rowToPage(row) : null;
  } finally {
    db.close();
  }
}

function rowToPublishedPage(row: DbRow): PublishedPageRecord {
  return {
    id: String(row.page_id),
    parentId: (row.parent_id as string | null) ?? null,
    sortKey: Number(row.sort_key),
    title: String(row.title ?? ''),
    slug: String(row.slug ?? ''),
    icon: (row.icon as string | null) ?? null,
    iconAssetId: (row.icon_asset_id as string | null) ?? null,
    coverAssetId: (row.cover_asset_id as string | null) ?? null,
    coverFocalX: Number(row.cover_focal_x ?? 50),
    coverFocalY: Number(row.cover_focal_y ?? 50),
    coverScale: Number(row.cover_scale ?? 100),
    kind: normalizePageKind(row.kind),
    summary: String(row.summary ?? ''),
    tags: normalizePageTags(row.tags_json),
    bodyMarkdown: String(row.body_markdown ?? ''),
    revision: Number(row.source_revision),
    createdAt: Number(row.source_created_at),
    updatedAt: Number(row.source_updated_at),
    deletedAt: null,
    visibility: row.visibility === 'unlisted' ? 'unlisted' : 'public',
    sourceRevision: Number(row.source_revision),
    publishedAt: Number(row.published_at),
  };
}

export function getPagePublication(pageId: string, dataDir?: string): PagePublicationRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db.prepare('SELECT page_id, visibility, source_revision, published_at FROM page_publications WHERE page_id = ?').get(pageId) as DbRow | undefined;
    return row ? {
      pageId: String(row.page_id),
      visibility: String(row.visibility) as PublicationVisibility,
      sourceRevision: row.source_revision == null ? null : Number(row.source_revision),
      publishedAt: row.published_at == null ? null : Number(row.published_at),
    } : null;
  } finally { db.close(); }
}

export function getPublishedPage(pageId: string, dataDir?: string): PublishedPageRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db.prepare("SELECT * FROM page_publications WHERE page_id = ? AND visibility IN ('public', 'unlisted') AND source_revision IS NOT NULL").get(pageId) as DbRow | undefined;
    return row ? rowToPublishedPage(row) : null;
  } finally { db.close(); }
}

export function listPublishedPages(includeUnlisted = false, dataDir?: string, includeCollectionPages = true): PublishedPageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db.prepare(
      `SELECT pp.* FROM page_publications pp
       WHERE pp.visibility ${includeUnlisted ? "IN ('public', 'unlisted')" : "= 'public'"}
         AND pp.source_revision IS NOT NULL
         ${includeCollectionPages ? '' : 'AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.page_id = pp.page_id)'}
       ORDER BY pp.parent_id IS NULL DESC, pp.sort_key ASC, pp.title COLLATE NOCASE ASC`,
    ).all() as DbRow[];
    return rows.map(rowToPublishedPage);
  } finally { db.close(); }
}

export function resolvePublishedPageRoutePath(segments: string[], includeUnlisted = true, dataDir?: string): PageRouteResolution | null {
  const pages = listPublishedPages(includeUnlisted, dataDir);
  const cleanSegments = segments.map((segment) => segment.trim()).filter(Boolean);
  const requestedPath = cleanSegments.join('/');
  const pageId = resolveWorkspacePagePathSegments(cleanSegments, pages);
  return pageId ? { pageId, canonicalPath: buildWorkspacePagePathFromPages(pageId, pages), requestedPath } : null;
}

export function publishPage(pageId: string, visibility: Exclude<PublicationVisibility, 'private'>, dataDir?: string): PublishedPageRecord {
  const db = createStorageConnection(dataDir);
  try {
    const pageRow = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as DbRow | undefined;
    if (!pageRow) throw new Error('Page not found');
    const page = rowToPage(pageRow);
    let ancestorId = page.parentId;
    while (ancestorId) {
      const ancestor = db.prepare('SELECT parent_id FROM pages WHERE id = ? AND deleted_at IS NULL').get(ancestorId) as DbRow | undefined;
      const publication = db.prepare("SELECT visibility, source_revision FROM page_publications WHERE page_id = ? AND visibility IN ('public', 'unlisted')").get(ancestorId) as DbRow | undefined;
      if (!ancestor || publication?.source_revision == null || (visibility === 'public' && publication.visibility !== 'public')) {
        throw new Error(visibility === 'public' ? 'Publish parent pages publicly before publishing this child.' : 'Publish parent pages before publishing this child.');
      }
      ancestorId = (ancestor.parent_id as string | null) ?? null;
    }
    const publishedAt = Date.now();
    db.exec('BEGIN IMMEDIATE;');
    db.prepare(`
      UPDATE page_publications SET visibility = ?, source_revision = ?, parent_id = ?, sort_key = ?, slug = ?, title = ?, icon = ?, icon_asset_id = ?, cover_asset_id = ?, cover_focal_x = ?, cover_focal_y = ?, cover_scale = ?, kind = ?, summary = ?, tags_json = ?, body_markdown = ?, source_created_at = ?, source_updated_at = ?, published_at = ? WHERE page_id = ?
    `).run(visibility, page.revision, page.parentId, page.sortKey, page.slug, page.title, page.icon, page.iconAssetId, page.coverAssetId, page.coverFocalX, page.coverFocalY, page.coverScale, page.kind, page.summary, JSON.stringify(page.tags), page.bodyMarkdown, page.createdAt, page.updatedAt, publishedAt, pageId);
    db.prepare('DELETE FROM published_page_collection_views WHERE page_id = ?').run(pageId);
    const embeddedViews = db.prepare(`
      SELECT pcv.view_id, pcv.sort_key, cv.collection_id
      FROM page_collection_views pcv
      JOIN collection_views cv ON cv.id = pcv.view_id
      WHERE pcv.page_id = ?
    `).all(pageId) as DbRow[];
    for (const embeddedView of embeddedViews) {
      const collectionRow = db.prepare('SELECT id, name, created_at, updated_at FROM collections WHERE id = ? AND deleted_at IS NULL').get(String(embeddedView.collection_id)) as DbRow | undefined;
      if (!collectionRow) continue;
      const collection = rowToCollection(collectionRow, db);
      const items = (db.prepare('SELECT collection_id, page_id, sort_key FROM collection_items WHERE collection_id = ? ORDER BY sort_key ASC').all(collection.id) as DbRow[])
        .map((row) => rowToCollectionItem(row, db));
      db.prepare('INSERT INTO published_page_collection_views (page_id, view_id, sort_key, snapshot_json) VALUES (?, ?, ?, ?)')
        .run(pageId, String(embeddedView.view_id), Number(embeddedView.sort_key), JSON.stringify({ collection, items }));
    }
    db.exec('COMMIT;');
    return rowToPublishedPage(db.prepare('SELECT * FROM page_publications WHERE page_id = ?').get(pageId) as DbRow);
  } finally { db.close(); }
}

export function unpublishPage(pageId: string, dataDir?: string): PagePublicationRecord {
  const db = createStorageConnection(dataDir);
  try {
    if (!db.prepare('SELECT 1 FROM page_publications WHERE page_id = ?').get(pageId)) throw new Error('Page not found');
    const publishedChildren = db.prepare("SELECT COUNT(*) AS count FROM page_publications WHERE parent_id = ? AND visibility IN ('public', 'unlisted')").get(pageId) as DbRow;
    if (Number(publishedChildren.count) > 0) throw new Error('Unpublish child pages first.');
    db.exec('BEGIN IMMEDIATE;');
    db.prepare('DELETE FROM published_page_collection_views WHERE page_id = ?').run(pageId);
    db.prepare("UPDATE page_publications SET visibility = 'private', source_revision = NULL, parent_id = NULL, sort_key = NULL, slug = NULL, title = NULL, icon = NULL, icon_asset_id = NULL, cover_asset_id = NULL, cover_focal_x = NULL, cover_focal_y = NULL, cover_scale = NULL, kind = NULL, summary = NULL, tags_json = NULL, body_markdown = NULL, source_created_at = NULL, source_updated_at = NULL, published_at = NULL WHERE page_id = ?").run(pageId);
    db.exec('COMMIT;');
    return { pageId, visibility: 'private', sourceRevision: null, publishedAt: null };
  } finally { db.close(); }
}

export function createPage(input: NewPage, dataDir?: string): PageRecord {
  const bodyMarkdown = normalizeMarkdownExtensions(input.bodyMarkdown ?? '');
  const documentIssues = validateMarkdown(bodyMarkdown);
  if (documentIssues.length) throw new Error(`Invalid Arcane Markdown: ${documentIssues.join(' ')}`);
  if (Buffer.byteLength(bodyMarkdown, 'utf8') > 5 * 1024 * 1024) throw new Error('Page content is too large to save.');
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
      INSERT INTO pages (id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
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
      normalizePageKind(input.kind),
      input.summary?.trim().slice(0, 240) ?? '',
      JSON.stringify(normalizePageTags(input.tags)),
      bodyMarkdown,
      now,
      now,
    );
    db.prepare('INSERT INTO page_publications (page_id, visibility) VALUES (?, ?)').run(pageId, 'private');
    rebuildBacklinks(db, pageId);

    const row = db.prepare(
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
    if (Object.hasOwn(input, 'kind')) {
      fields.push('kind = ?');
      values.push(normalizePageKind(input.kind));
    }
    if (Object.hasOwn(input, 'summary')) {
      fields.push('summary = ?');
      values.push((input.summary ?? '').trim().slice(0, 240));
    }
    if (Object.hasOwn(input, 'tags')) {
      fields.push('tags_json = ?');
      values.push(JSON.stringify(normalizePageTags(input.tags)));
    }
    if (input.bodyMarkdown !== undefined) {
      const bodyMarkdown = normalizeMarkdownExtensions(input.bodyMarkdown);
      const documentIssues = validateMarkdown(bodyMarkdown);
      if (documentIssues.length) throw new Error(`Invalid Arcane Markdown: ${documentIssues.join(' ')}`);
      if (Buffer.byteLength(bodyMarkdown, 'utf8') > 5 * 1024 * 1024) throw new Error('Page content is too large to save.');
      fields.push('body_markdown = ?');
      values.push(bodyMarkdown);
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
      `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
      kind: source.kind,
      summary: source.summary,
      tags: source.tags,
      bodyMarkdown: source.bodyMarkdown,
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, slug, title, icon, icon_asset_id, cover_asset_id, cover_focal_x, cover_focal_y, cover_scale, kind, summary, tags_json, body_markdown, revision, created_at, updated_at, deleted_at
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
        `SELECT id, filename, mime_type, sha256, size, width, height, prompt, created_at
         FROM assets
         ORDER BY created_at DESC`,
      )
      .all() as DbRow[];
    return rows.map(rowToAsset);
  } finally {
    db.close();
  }
}

export function isAssetPublished(assetId: string, dataDir?: string): boolean {
  const db = createStorageConnection(dataDir);
  try {
    const direct = db.prepare(`
      SELECT 1 FROM page_publications
      WHERE visibility IN ('public', 'unlisted') AND source_revision IS NOT NULL
        AND (icon_asset_id = ? OR cover_asset_id = ? OR body_markdown LIKE ?)
      LIMIT 1
    `).get(assetId, assetId, `%arcane://asset/sha256:${assetId}%`);
    if (direct) return true;
    return Boolean(db.prepare(`
      SELECT 1 FROM published_page_collection_views pcv
      JOIN page_publications pp ON pp.page_id = pcv.page_id
      WHERE pp.visibility = 'public' AND pp.source_revision IS NOT NULL AND pcv.snapshot_json LIKE ?
      LIMIT 1
    `).get(`%${assetId}%`));
  } finally { db.close(); }
}

export function getAsset(id: string, dataDir?: string): AssetRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare(
        `SELECT id, filename, mime_type, sha256, size, width, height, prompt, created_at
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
      `SELECT id, filename, mime_type, sha256, size, width, height, prompt, created_at
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
    prompt?: string | null;
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
    const prompt = options.prompt?.trim() || null;
    if (existing) {
      if (prompt && !existing.prompt) {
        db.prepare('UPDATE assets SET prompt = ? WHERE id = ?').run(prompt, existing.id);
        existing.prompt = prompt;
      }
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
      `INSERT INTO assets (id, filename, mime_type, sha256, size, width, height, prompt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      filename,
      options.mimeType,
      hash,
      sourceData.length,
      options.width ?? null,
      options.height ?? null,
      prompt,
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
        prompt,
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
        `SELECT id, name, created_at, updated_at
         FROM collections
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all() as DbRow[];
    return rows.map((row) => rowToCollection(row, db));
  } finally {
    db.close();
  }
}

export function listPublishedCollections(dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db.prepare(
      `SELECT pcv.snapshot_json
       FROM published_page_collection_views pcv
       JOIN page_publications pp ON pp.page_id = pcv.page_id
       WHERE pp.visibility = 'public' AND pp.source_revision IS NOT NULL
       ORDER BY pp.published_at DESC`,
    ).all() as DbRow[];
    const collections = new Map<string, CollectionRecord>();
    for (const row of rows) {
      const snapshot = JSON.parse(String(row.snapshot_json)) as { collection: CollectionRecord };
      if (!collections.has(snapshot.collection.id)) collections.set(snapshot.collection.id, snapshot.collection);
    }
    return [...collections.values()];
  } finally { db.close(); }
}

export function getPublishedCollectionSnapshot(collectionId: string, dataDir?: string): { collection: CollectionRecord; items: CollectionItemRecord[] } | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db.prepare(`
      SELECT ppcv.snapshot_json
      FROM published_page_collection_views ppcv
      JOIN collection_views cv ON cv.id = ppcv.view_id
      JOIN page_publications pp ON pp.page_id = ppcv.page_id
      WHERE cv.collection_id = ? AND pp.visibility IN ('public', 'unlisted') AND pp.source_revision IS NOT NULL
      ORDER BY pp.published_at DESC LIMIT 1
    `).get(collectionId) as DbRow | undefined;
    if (!row) return null;
    return JSON.parse(String(row.snapshot_json)) as { collection: CollectionRecord; items: CollectionItemRecord[] };
  } finally { db.close(); }
}

export function isCollectionPublished(collectionId: string, dataDir?: string): boolean {
  return getPublishedCollectionSnapshot(collectionId, dataDir) !== null;
}

export function listCollectionsHostedByPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT c.id, c.name, c.created_at, c.updated_at
         FROM collections c
         JOIN collection_views cv ON cv.collection_id = c.id
         JOIN page_collection_views pcv ON pcv.view_id = cv.id
         WHERE pcv.page_id = ? AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC`,
      )
      .all(pageId) as DbRow[];
    return rows.map((row) => rowToCollection(row, db));
  } finally {
    db.close();
  }
}

export function listPublishedCollectionsHostedByPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db.prepare(`
      SELECT pcv.snapshot_json FROM published_page_collection_views pcv
      JOIN page_publications pp ON pp.page_id = pcv.page_id
      WHERE pcv.page_id = ? AND pp.visibility IN ('public', 'unlisted') AND pp.source_revision IS NOT NULL
      ORDER BY pcv.sort_key ASC
    `).all(pageId) as DbRow[];
    return rows.map((row) => (JSON.parse(String(row.snapshot_json)) as { collection: CollectionRecord }).collection);
  } finally { db.close(); }
}

export function listCollectionsForPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT c.id, c.name, c.created_at, c.updated_at
         FROM collections c
         JOIN collection_items ci ON ci.collection_id = c.id
         WHERE ci.page_id = ? AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC`,
      )
      .all(pageId) as DbRow[];
    return rows.map((row) => rowToCollection(row, db));
  } finally {
    db.close();
  }
}

export function listPublishedCollectionsForPage(pageId: string, dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db.prepare(`
      SELECT pcv.snapshot_json FROM published_page_collection_views pcv
      JOIN page_publications pp ON pp.page_id = pcv.page_id
      WHERE pp.visibility = 'public' AND pp.source_revision IS NOT NULL
      ORDER BY pp.published_at DESC
    `).all() as DbRow[];
    const collections = new Map<string, CollectionRecord>();
    for (const row of rows) {
      const snapshot = JSON.parse(String(row.snapshot_json)) as { collection: CollectionRecord; items: CollectionItemRecord[] };
      if (snapshot.items.some((item) => item.pageId === pageId) && !collections.has(snapshot.collection.id)) collections.set(snapshot.collection.id, snapshot.collection);
    }
    return [...collections.values()];
  } finally { db.close(); }
}

export function listCollectionPages(dataDir?: string): CollectionRecord[] {
  return listCollections(dataDir);
}

export function getCollection(collectionId: string, dataDir?: string): CollectionRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare(
        `SELECT id, name, created_at, updated_at
         FROM collections
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(collectionId) as DbRow | undefined;
    return row ? rowToCollection(row, db) : null;
  } finally {
    db.close();
  }
}

export function createCollection(
  input: {
    name: string;
    embedPageId?: string | null;
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
    if (input.embedPageId) {
      const page = db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(input.embedPageId);
      if (!page) throw new Error('Collection embed page not found');
    }

    const normalizedSchema = normalizeCollectionSchema(input.schema);
    const schema = isBooksCollectionName(name) && normalizedSchema.properties.length === 0 ? BOOKS_COLLECTION_SCHEMA : normalizedSchema;
    const views = normalizeCollectionViews(input.views);

    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      `INSERT INTO collections (id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(id, name, now, now);
    const insertProperty = db.prepare(
      'INSERT INTO collection_properties (id, collection_id, key, name, type, position, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    schema.properties.forEach((property, index) => insertProperty.run(
      randomUUID(), id, property.id, property.name, property.type, index,
      JSON.stringify({ options: property.options ?? [], optionColors: property.optionColors ?? {} }),
    ));
    const viewId = randomUUID();
    db.prepare(
      'INSERT INTO collection_views (id, collection_id, name, mode, config_json, position) VALUES (?, ?, ?, ?, ?, 0)',
    ).run(viewId, id, 'Default', views.mode, JSON.stringify({ sort: views.sort, filter: views.filter }));
    if (input.embedPageId) {
      db.prepare('INSERT INTO page_collection_views (page_id, view_id, sort_key) VALUES (?, ?, 0)').run(input.embedPageId, viewId);
    }
    const row = db.prepare('SELECT id, name, created_at, updated_at FROM collections WHERE id = ?').get(id) as DbRow | undefined;
    if (!row) throw new Error('Could not load created collection');
    const result = rowToCollection(row, db);
    db.exec('COMMIT');
    return result;
  } finally {
    db.close();
  }
}

export function updateCollection(
  collectionId: string,
  updates: {
    name?: string;
    embedPageId?: string | null;
    schema?: CollectionSchema;
    views?: CollectionViews;
  },
  dataDir?: string,
): CollectionRecord {
  const db = createStorageConnection(dataDir);
  let inTransaction = false;
  try {
    const row = db.prepare('SELECT id, name, created_at, updated_at FROM collections WHERE id = ? AND deleted_at IS NULL').get(collectionId) as DbRow | undefined;
    if (!row) throw new Error('Collection not found');
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) throw new Error('Collection name is required');
      db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, collectionId);
    }

    const view = db.prepare('SELECT id FROM collection_views WHERE collection_id = ? ORDER BY position ASC LIMIT 1').get(collectionId) as DbRow | undefined;
    if (!view) throw new Error('Collection default view is missing');
    const viewId = String(view.id);

    if (Object.hasOwn(updates, 'embedPageId')) {
      const pageId = updates.embedPageId ?? null;
      if (pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId)) {
        throw new Error('Collection display page not found');
      }
      db.prepare('DELETE FROM page_collection_views WHERE view_id = ?').run(viewId);
      if (pageId) db.prepare('INSERT INTO page_collection_views (page_id, view_id, sort_key) VALUES (?, ?, 0)').run(pageId, viewId);
    }

    if (updates.schema !== undefined) {
      const schema = normalizeCollectionSchema(updates.schema);
      const existing = db.prepare('SELECT id, key FROM collection_properties WHERE collection_id = ?').all(collectionId) as DbRow[];
      const existingByKey = new Map(existing.map((property) => [String(property.key), String(property.id)]));
      const retainedKeys = new Set(schema.properties.map((property) => property.id));
      for (const property of existing) {
        if (!retainedKeys.has(String(property.key))) db.prepare('DELETE FROM collection_properties WHERE id = ?').run(String(property.id));
      }
      const insert = db.prepare('INSERT INTO collection_properties (id, collection_id, key, name, type, position, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const update = db.prepare('UPDATE collection_properties SET name = ?, type = ?, position = ?, config_json = ? WHERE id = ?');
      schema.properties.forEach((property, index) => {
        const config = JSON.stringify({ options: property.options ?? [], optionColors: property.optionColors ?? {} });
        const propertyId = existingByKey.get(property.id);
        if (propertyId) update.run(property.name, property.type, index, config, propertyId);
        else insert.run(randomUUID(), collectionId, property.id, property.name, property.type, index, config);
      });
    }

    if (updates.views !== undefined) {
      const views = normalizeCollectionViews(updates.views);
      db.prepare('UPDATE collection_views SET mode = ?, config_json = ? WHERE id = ?').run(
        views.mode, JSON.stringify({ sort: views.sort, filter: views.filter }), viewId,
      );
    }

    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(Date.now(), collectionId);
    const updatedRow = db.prepare('SELECT id, name, created_at, updated_at FROM collections WHERE id = ?').get(collectionId) as DbRow;
    const result = rowToCollection(updatedRow, db);
    db.exec('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) db.exec('ROLLBACK');
    throw error;
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

function rowToCollectionView(row: DbRow): CollectionViewRecord {
  let config: Omit<CollectionViews, 'mode'> = {};
  try { config = JSON.parse(String(row.config_json)) as Omit<CollectionViews, 'mode'>; } catch { /* invalid config degrades to defaults */ }
  return {
    id: String(row.id),
    collectionId: String(row.collection_id),
    name: String(row.name),
    mode: row.mode === 'gallery' ? 'gallery' : 'table',
    config,
    position: Number(row.position),
  };
}

export function listCollectionViews(collectionId: string, dataDir?: string): CollectionViewRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    return (db.prepare(
      'SELECT id, collection_id, name, mode, config_json, position FROM collection_views WHERE collection_id = ? ORDER BY position ASC',
    ).all(collectionId) as DbRow[]).map(rowToCollectionView);
  } finally { db.close(); }
}

export function createCollectionView(
  collectionId: string,
  input: { name: string; settings?: CollectionViews },
  dataDir?: string,
): CollectionViewRecord {
  const db = createStorageConnection(dataDir);
  try {
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL').get(collectionId)) throw new Error('Collection not found');
    const settings = normalizeCollectionViews(input.settings);
    const max = db.prepare('SELECT MAX(position) AS position FROM collection_views WHERE collection_id = ?').get(collectionId) as DbRow;
    const position = max.position == null ? 0 : Number(max.position) + 1;
    const id = randomUUID();
    db.prepare('INSERT INTO collection_views (id, collection_id, name, mode, config_json, position) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, collectionId, input.name.trim() || 'View', settings.mode, JSON.stringify({ sort: settings.sort, filter: settings.filter }), position,
    );
    return rowToCollectionView(db.prepare('SELECT id, collection_id, name, mode, config_json, position FROM collection_views WHERE id = ?').get(id) as DbRow);
  } finally { db.close(); }
}

export function embedCollectionView(pageId: string, viewId: string, sortKey = 0, dataDir?: string): PageCollectionViewRecord {
  const db = createStorageConnection(dataDir);
  try {
    if (!db.prepare('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId)) throw new Error('Page not found');
    if (!db.prepare('SELECT 1 FROM collection_views WHERE id = ?').get(viewId)) throw new Error('Collection view not found');
    db.prepare(
      `INSERT INTO page_collection_views (page_id, view_id, sort_key) VALUES (?, ?, ?)
       ON CONFLICT(page_id, view_id) DO UPDATE SET sort_key = excluded.sort_key`,
    ).run(pageId, viewId, sortKey);
    return { pageId, viewId, sortKey };
  } finally { db.close(); }
}

export function removeCollectionViewEmbed(pageId: string, viewId: string, dataDir?: string): void {
  const db = createStorageConnection(dataDir);
  try { db.prepare('DELETE FROM page_collection_views WHERE page_id = ? AND view_id = ?').run(pageId, viewId); }
  finally { db.close(); }
}

function readCollectionItemValues(collectionId: string, pageId: string, db: DatabaseSync): Record<string, unknown> {
  const rows = db.prepare(
    `SELECT cp.key, cv.value_json
     FROM collection_values cv
     JOIN collection_properties cp ON cp.id = cv.property_id
     WHERE cv.collection_id = ? AND cv.page_id = ?
     ORDER BY cp.position ASC`,
  ).all(collectionId, pageId) as DbRow[];
  return Object.fromEntries(rows.map((row) => {
    try { return [String(row.key), JSON.parse(String(row.value_json))]; }
    catch { return [String(row.key), null]; }
  }));
}

function rowToCollectionItem(row: DbRow, db: DatabaseSync): CollectionItemRecord {
  const collectionId = String(row.collection_id);
  const pageId = String(row.page_id);
  return {
    collectionId,
    pageId,
    properties: readCollectionItemValues(collectionId, pageId, db),
    sortKey: Number(row.sort_key),
  };
}

export function listCollectionItems(collectionId: string, dataDir?: string): CollectionItemRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db.prepare(
      `SELECT collection_id, page_id, sort_key FROM collection_items
       WHERE collection_id = ? ORDER BY sort_key ASC`,
    ).all(collectionId) as DbRow[];
    return rows.map((row) => rowToCollectionItem(row, db));
  } finally {
    db.close();
  }
}

function getCollectionItem(collectionId: string, pageId: string, db: DatabaseSync): CollectionItemRecord | null {
  const row = db.prepare(
    `SELECT collection_id, page_id, sort_key FROM collection_items
     WHERE collection_id = ? AND page_id = ?`,
  ).get(collectionId, pageId) as DbRow | undefined;
  return row ? rowToCollectionItem(row, db) : null;
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

    db.prepare(
      `INSERT INTO collection_items (collection_id, page_id, sort_key) VALUES (?, ?, ?)`,
    ).run(input.collectionId, input.pageId, sortKey);
    writeCollectionItemValues(input.collectionId, input.pageId, input.properties ?? {}, db);
    return getCollectionItem(input.collectionId, input.pageId, db)!;
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

    writeCollectionItemValues(input.collectionId, input.pageId, input.properties, db);
    return getCollectionItem(input.collectionId, input.pageId, db)!;
  } finally {
    db.close();
  }
}

function writeCollectionItemValues(collectionId: string, pageId: string, values: Record<string, unknown>, db: DatabaseSync): void {
  const propertyRows = db.prepare('SELECT id, key FROM collection_properties WHERE collection_id = ?').all(collectionId) as DbRow[];
  const propertyByKey = new Map(propertyRows.map((property) => [String(property.key), String(property.id)]));
  const upsert = db.prepare(
    `INSERT INTO collection_values (collection_id, page_id, property_id, value_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(collection_id, page_id, property_id) DO UPDATE SET value_json = excluded.value_json`,
  );
  for (const [key, value] of Object.entries(values)) {
    const propertyId = propertyByKey.get(key);
    if (!propertyId) throw new Error(`Unknown collection property: ${key}`);
    upsert.run(collectionId, pageId, propertyId, JSON.stringify(value));
  }
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

export function getSettings(dataDir?: string): { schemaVersion: number; workspaceName: string } {
  const db = createStorageConnection(dataDir);
  try {
    const row = db.prepare('SELECT schema_version, workspace_name FROM settings ORDER BY schema_version DESC LIMIT 1').get() as DbRow | undefined;
    if (!row) {
      const now = Date.now();
      db.prepare('INSERT INTO settings (schema_version, workspace_name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', now, now);
      return { schemaVersion: CURRENT_SCHEMA_VERSION, workspaceName: 'Arcane Codex' };
    }
    return { schemaVersion: Number(row.schema_version), workspaceName: String(row.workspace_name) };
  } finally { db.close(); }
}

export function updateSettings(dataDir: string | undefined, updates: { workspaceName?: string }): { schemaVersion: number; workspaceName: string } {
  const db = createStorageConnection(dataDir);
  try {
    const workspaceName = typeof updates.workspaceName === 'string' && updates.workspaceName.trim() ? updates.workspaceName.trim() : undefined;
    if (workspaceName !== undefined) db.prepare('UPDATE settings SET workspace_name = ?, updated_at = ?').run(workspaceName, Date.now());
    return getSettings(dataDir);
  } finally { db.close(); }
}

export function rebuildBacklinks(db: DatabaseSync, pageId: string): void {
  db.prepare('DELETE FROM page_links WHERE source_page_id = ?').run(pageId);
  const row = db.prepare('SELECT body_markdown FROM pages WHERE id = ?').get(pageId) as DbRow | undefined;
  if (!row?.body_markdown) {
    return;
  }

  const ids = extractLinkedPageIds(String(row.body_markdown));
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
        `SELECT DISTINCT p.id, p.parent_id, p.sort_key, p.slug, p.title, p.icon, p.icon_asset_id, p.cover_asset_id, p.cover_focal_x, p.cover_focal_y, p.cover_scale, p.kind, p.summary, p.tags_json, p.body_markdown, p.revision, p.created_at, p.updated_at, p.deleted_at
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

export function extractLinkedPageIds(bodyMarkdown: string): string[] {
  return pageIdsFromMarkdown(bodyMarkdown);
}
