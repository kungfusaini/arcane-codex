import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AssetRecord,
  CollectionItemRecord,
  CollectionRecord,
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

const CURRENT_SCHEMA_VERSION = 1;

export type StorageHandle = {
  dbPath: string;
  dataDir: string;
};

type DbRow = Record<string, unknown>;

export function openWorkspace(options?: { dataDir?: string }): StorageHandle {
  const workspaceDir = getWorkspaceBaseDir(options?.dataDir);
  ensureWorkspaceDirs(options?.dataDir);
  const dbPath = getWorkspaceDbPath(options?.dataDir);
  const db = new DatabaseSync(dbPath);

  ensurePragmas(db);
  runMigrations(db);

  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get() as
    | DbRow
    | undefined;
  if (!row) {
    throw new Error('Migration failed to create settings table');
  }

  const settings = db.prepare('SELECT COUNT(*) as count FROM settings').get() as DbRow;
  if (!(Number(settings.count) > 0)) {
    const now = Date.now();
    db.prepare(
      'INSERT INTO settings (schema_version, workspace_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', now, now);
  }

  const integrity = db.prepare('PRAGMA integrity_check').get() as DbRow;
  if (String(integrity.integrity_check) !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  }

  db.close();
  return { dbPath, dataDir: workspaceDir };
}

function ensurePragmas(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
}

function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version;').get() as DbRow;
  const currentVersion = Number(row.user_version ?? 0);

  if (currentVersion < 1) {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
        sort_key REAL NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        icon TEXT,
        cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
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
    `;
    db.exec(schemaSql);
    db.exec('PRAGMA user_version = 1;');
  }

  if (currentVersion !== CURRENT_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
  }
}

export function createStorageConnection(dataDir?: string): DatabaseSync {
  const workspace = openWorkspace({ dataDir });
  return new DatabaseSync(workspace.dbPath);
}

function rowToPage(row: DbRow): PageRecord {
  return {
    id: String(row.id),
    parentId: (row.parent_id as string | null) ?? null,
    sortKey: Number(row.sort_key),
    title: String(row.title),
    icon: (row.icon as string | null) ?? null,
    coverAssetId: (row.cover_asset_id as string | null) ?? null,
    contentJson: String(row.content_json),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

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

export function listPages(dataDir?: string): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, title, icon, cover_asset_id, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL
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
        `SELECT id, parent_id, sort_key, title, icon, cover_asset_id, content_json, revision, created_at, updated_at, deleted_at
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
        `SELECT id, parent_id, sort_key, title, icon, cover_asset_id, content_json, revision, created_at, updated_at, deleted_at
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

  try {
    const stmt = db.prepare(`
      INSERT INTO pages (id, parent_id, sort_key, title, icon, cover_asset_id, content_json, revision, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
    `);
    stmt.run(
      pageId,
      input.parentId ?? null,
      sortKey,
      input.title,
      input.icon ?? null,
      input.coverAssetId ?? null,
      input.contentJson ?? '[]',
      now,
      now,
    );

    const page = getPage(pageId, dataDir);
    if (!page) {
      throw new Error('Could not load created page');
    }
    return page;
  } finally {
    db.close();
  }
}

function normalizeSortKey(baseSort: number, index: number): number {
  return Number.parseFloat(`${baseSort}.${index + 1}`);
}

export function applyPageMoves(moves: PageMoveInput[], dataDir?: string): PageRecord[] {
  if (moves.length === 0) {
    return [];
  }

  const db = createStorageConnection(dataDir);

  try {
    db.exec('BEGIN');
    const now = Date.now();
    const currentStmt = db.prepare('SELECT id, revision, deleted_at FROM pages WHERE id = ?');
    const updateStmt = db.prepare(
      `UPDATE pages
       SET parent_id = ?,
           sort_key = ?,
           revision = revision + 1,
           updated_at = ?
       WHERE id = ?`,
    );

    const updated: PageRecord[] = [];
    const seen = new Set<string>();

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
      updateStmt.run(move.parentId, move.sortKey, now, move.id);
    }

    for (const move of moves) {
      const page = getPage(move.id, dataDir);
      if (page) {
        updated.push(page);
      }
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

export function updatePage(id: string, input: PageUpdate, dataDir?: string): PageRecord {
  const db = createStorageConnection(dataDir);
  try {
    const current = db.prepare('SELECT revision FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as DbRow | undefined;

    if (!current) {
      throw new Error('Page not found');
    }

    const currentRevision = Number(current.revision);
    if (currentRevision !== input.revision) {
      throw new RevisionConflictError('Stale revision supplied');
    }

    const fields = [] as string[];
    const values: Array<string | number | null> = [];

    if (Object.hasOwn(input, 'parentId')) {
      fields.push('parent_id = ?');
      values.push(input.parentId ?? null);
    }
    if (input.sortKey !== undefined) {
      fields.push('sort_key = ?');
      values.push(input.sortKey);
    }
    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
    }
    if (Object.hasOwn(input, 'icon')) {
      const has = input.icon as string | null | undefined;
      fields.push('icon = ?');
      values.push(has ?? null);
    }
    if (Object.hasOwn(input, 'coverAssetId')) {
      const cover = input.coverAssetId as string | null | undefined;
      fields.push('cover_asset_id = ?');
      values.push(cover ?? null);
    }
    if (input.contentJson !== undefined) {
      fields.push('content_json = ?');
      values.push(input.contentJson);
    }

    if (!fields.length) {
      const untouched = getPage(id, dataDir);
      if (!untouched) {
        throw new Error('Page not found');
      }
      return untouched;
    }

    fields.push('revision = revision + 1', 'updated_at = ?');
    values.push(Date.now(), id);

    const stmt = db.prepare(`UPDATE pages SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const updated = getPage(id, dataDir);
    if (!updated) {
      throw new Error('Could not load updated page');
    }

    rebuildBacklinks(db, id);
    return updated;
  } finally {
    db.close();
  }
}

export function trashPage(id: string, dataDir?: string): void {
  const db = createStorageConnection(dataDir);
  try {
    const now = Date.now();
    db.prepare('UPDATE pages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  } finally {
    db.close();
  }
}

export function restorePage(id: string, dataDir?: string): PageRecord | null {
  const db = createStorageConnection(dataDir);
  try {
    const now = Date.now();
    db.prepare('UPDATE pages SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id);
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
      coverAssetId: source.coverAssetId,
      contentJson: source.contentJson,
      sortKey: normalizeSortKey(source.sortKey, 1),
    },
    dataDir,
  );
}

export function searchPages(query: string, dataDir?: string): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(
        `SELECT id, parent_id, sort_key, title, icon, cover_asset_id, content_json, revision, created_at, updated_at, deleted_at
         FROM pages
         WHERE deleted_at IS NULL AND title LIKE ?
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
): AssetRecord {
  const db = createStorageConnection(dataDir);
  const assetDir = getWorkspaceAssetsDir(dataDir);
  mkdirSync(assetDir, { recursive: true });

  const id = randomUUID();
  const ext = path.extname(options.filename);
  const targetPath = path.join(assetDir, `${id}${ext}`);
  const sourceData = readFileSync(options.sourcePath);
  const hash = createHash('sha256').update(sourceData).digest('hex');
  const now = Date.now();

  writeFileSync(targetPath, sourceData);

  db.prepare(
    `INSERT INTO assets (id, filename, mime_type, sha256, size, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.filename,
    options.mimeType,
    hash,
    sourceData.length,
    options.width ?? null,
    options.height ?? null,
    now,
  );
  db.close();

  return {
    id,
    filename: options.filename,
    mimeType: options.mimeType,
    sha256: hash,
    size: sourceData.length,
    width: options.width ?? null,
    height: options.height ?? null,
    createdAt: now,
  };
}

export function listCollectionPages(dataDir?: string): CollectionRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT id, host_page_id, name, schema_json, views_json, created_at, updated_at
         FROM collections
         ORDER BY updated_at DESC`,
      )
      .all() as DbRow[];
    return rows.map((row) => ({
      id: String(row.id),
      hostPageId: (row.host_page_id as string | null) ?? null,
      name: String(row.name),
      schemaJson: String(row.schema_json),
      viewsJson: String(row.views_json),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
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

export function getSettings(dataDir?: string): { schemaVersion: number; workspaceName: string } {
  const db = createStorageConnection(dataDir);
  try {
    const row = db
      .prepare('SELECT schema_version, workspace_name FROM settings ORDER BY schema_version DESC LIMIT 1')
      .get() as DbRow | undefined;
    if (!row) {
      const now = Date.now();
      db.prepare(
        'INSERT INTO settings (schema_version, workspace_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(CURRENT_SCHEMA_VERSION, 'Arcane Codex', now, now);
      return { schemaVersion: CURRENT_SCHEMA_VERSION, workspaceName: 'Arcane Codex' };
    }
    return {
      schemaVersion: Number(row.schema_version),
      workspaceName: String(row.workspace_name),
    };
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

  for (const linkedId of ids) {
    const blockId = randomBytes(8).toString('hex');
    stmt.run(pageId, blockId, linkedId);
  }
}

export function readBacklinks(targetPageId: string, dataDir?: string): PageRecord[] {
  const db = createStorageConnection(dataDir);
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.parent_id, p.sort_key, p.title, p.icon, p.cover_asset_id, p.content_json, p.revision, p.created_at, p.updated_at, p.deleted_at
         FROM page_links l
         JOIN pages p ON p.id = l.source_page_id
         WHERE l.target_page_id = ? AND p.deleted_at IS NULL`,
      )
      .all(targetPageId) as DbRow[];
    return rows.map(rowToPage);
  } finally {
    db.close();
  }
}

function extractLinkedPageIds(contentJson: string): string[] {
  if (!contentJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(contentJson) as unknown;
    const ids = new Set<string>();
    if (!Array.isArray(parsed)) {
      return [];
    }

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
      if (typeof obj.pageId === 'string' && obj.pageId.length > 8) {
        ids.add(obj.pageId);
      }
      if (typeof obj.targetPageId === 'string' && obj.targetPageId.length > 8) {
        ids.add(obj.targetPageId);
      }

      if (obj.children !== undefined) {
        walk(obj.children);
      }
      if (obj.content !== undefined) {
        walk(obj.content);
      }
      if (obj.text !== undefined) {
        walk(obj.text);
      }
      if (obj.props !== undefined) {
        walk(obj.props);
      }
    };

    walk(parsed);
    return [...ids];
  } catch {
    return [];
  }
}
