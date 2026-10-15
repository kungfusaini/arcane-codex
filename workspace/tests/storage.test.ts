import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  applyCollectionItemMoves,
  applyPageMoves,
  createCollection,
  createCollectionItem,
  createCollectionView,
  createPage,
  createStorageConnection,
  duplicatePage,
  embedCollectionView,
  extractLinkedPageIds,
  getCollection,
  getPage,
  getPagePublication,
  getPublishedPage,
  getSettings,
  listCollectionItems,
  listCollectionsForPage,
  listCollectionsHostedByPage,
  listCollectionViews,
  listPages,
  listPublishedPages,
  openWorkspace,
  publishPage,
  readBacklinks,
  registerPagePathAlias,
  updateSettings,
  resolvePageRoutePath,
  restorePage,
  trashPage,
  updateCollection,
  updateCollectionItemProperties,
  unpublishPage,
  updatePage,
  WorkspaceIntegrityError,
} from '../src/lib/data/storage';
import { RevisionConflictError } from '../src/lib/data/types';
import {
  ensureWorkspaceDirs,
  getWorkspaceAssetsDir,
  getWorkspaceTrashDir,
  getWorkspaceDbPath,
} from '../src/lib/data/workspace';
import { buildPagePathFromPages } from '../src/lib/pageUrls';
import { toPublicPath } from '../src/lib/workspaceMode';

describe('workspace bootstrap', () => {
  it('creates required directories and schema', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(base);
    openWorkspace({ dataDir: base });

    assert.equal(existsSync(getWorkspaceAssetsDir(base)), true);
    assert.equal(existsSync(getWorkspaceTrashDir(base)), true);
    assert.equal(existsSync(getWorkspaceDbPath(base)), true);

    rmSync(base, { recursive: true, force: true });
  });

  it('rejects legacy and newer incompatible workspace schemas', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-migration-'));
    try {
      openWorkspace({ dataDir: base });
      const databasePath = getWorkspaceDbPath(base);
      const legacy = new DatabaseSync(databasePath);
      legacy.exec('PRAGMA user_version = 1;');
      legacy.close();

      assert.throws(
        () => openWorkspace({ dataDir: base }),
        (error: unknown) => error instanceof WorkspaceIntegrityError && /offline migration/.test(error.message),
      );

      const newer = new DatabaseSync(databasePath);
      newer.exec('PRAGMA user_version = 99;');
      newer.close();

      assert.throws(
        () => openWorkspace({ dataDir: base }),
        (error: unknown) => error instanceof WorkspaceIntegrityError && /newer/.test(error.message),
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('workspace settings', () => {
  it('stores workspace names independently of publication', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-settings-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    try {
      const initial = getSettings(workspace);
      assert.equal(initial.workspaceName, 'Arcane Codex');

      const updated = updateSettings(workspace, { workspaceName: 'Publications test' });
      assert.equal(updated.workspaceName, 'Publications test');

      const reread = getSettings(workspace);
      assert.equal(reread.workspaceName, 'Publications test');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('collections CRUD and item storage', () => {
  it('supports create, update schema, item updates, and item reorder', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    const first = createPage({ title: 'Project A' }, workspace);
    const second = createPage({ title: 'Project B' }, workspace);
    const collection = createCollection(
      {
        name: 'Projects',
        schema: {
          properties: [
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'progress', name: 'Progress', type: 'number' },
          ],
        },
      },
      workspace,
    );
    const books = createCollection({ name: 'Books' }, workspace);
    assert.equal(books.schema.properties[0].type, 'select');
    const solo = createPage({ title: 'Standalone' }, workspace);

    const firstItem = createCollectionItem(
      {
        collectionId: collection.id,
        pageId: first.id,
        properties: { status: 'Todo', progress: 25 },
      },
      workspace,
    );

    createCollectionItem(
      {
        collectionId: collection.id,
        pageId: second.id,
        properties: { status: 'Done', progress: 80 },
      },
      workspace,
    );

    const allPages = listPages(workspace);
    assert.equal(allPages.length, 3);
    assert.equal(listPages(workspace, false).length, 1);
    assert.equal(listPages(workspace, false).some((page) => page.id === solo.id), true);
    assert.equal(listPages(workspace, false).some((page) => page.id === first.id), false);

    const list = listCollectionItems(collection.id, workspace);
    assert.equal(list.length, 2);
    assert.equal(listCollectionsForPage(first.id, workspace)[0].id, collection.id);

    const updated = updateCollectionItemProperties(
      {
        collectionId: collection.id,
        pageId: firstItem.pageId,
        properties: { progress: 92 },
      },
      workspace,
    );
    assert.equal(typeof updated.properties.progress, 'number');

    const moved = applyCollectionItemMoves(
      [
        { collectionId: collection.id, pageId: second.id, sortKey: 1 },
        { collectionId: collection.id, pageId: first.id, sortKey: 2 },
      ],
      workspace,
    );
    assert.equal(moved[0].pageId, second.id);

    const next = listCollectionItems(collection.id, workspace);
    assert.equal(next[0].pageId, second.id);

    const collectionUpdated = updateCollection(
      collection.id,
      {
        schema: {
          properties: [
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done', 'Blocked'] },
            { id: 'progress', name: 'Progress', type: 'number' },
          ],
        },
        name: 'Project tracker',
      },
      workspace,
    );

    assert.equal(collectionUpdated.name, 'Project tracker');
    assert.equal(collectionUpdated.schema.properties[0].options?.includes('Blocked'), true);

    const embeddedPage = createPage({ title: 'Collection dashboard' }, workspace);
    const reusableView = createCollectionView(collection.id, { name: 'Gallery', settings: { mode: 'gallery' } }, workspace);
    embedCollectionView(embeddedPage.id, reusableView.id, 1, workspace);
    assert.equal(listCollectionViews(collection.id, workspace).length, 2);
    assert.equal(listCollectionsHostedByPage(embeddedPage.id, workspace)[0].id, collection.id);

    const database = createStorageConnection(workspace);
    const collectionColumns = database.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>;
    const itemColumns = database.prepare('PRAGMA table_info(collection_items)').all() as Array<{ name: string }>;
    assert.equal(collectionColumns.some((column) => ['host_page_id', 'schema_json', 'views_json'].includes(column.name)), false);
    assert.equal(itemColumns.some((column) => column.name === 'properties_json'), false);
    database.prepare('DELETE FROM pages WHERE id = ?').run(embeddedPage.id);
    database.close();
    assert.ok(getCollection(collection.id, workspace), 'deleting an embedding page must not delete its collection');
    assert.equal(listCollectionViews(collection.id, workspace).length, 2);
    rmSync(workspace, { recursive: true, force: true });
  });
});

describe('publication snapshots', () => {
  it('keeps private drafts off the public surface and publishes immutable snapshots', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-publication-'));
    try {
      openWorkspace({ dataDir: workspace });
      const root = createPage({ title: 'Private root', bodyMarkdown: 'Draft one\n' }, workspace);
      const child = createPage({ title: 'Child', parentId: root.id }, workspace);
      assert.equal(getPagePublication(root.id, workspace)?.visibility, 'private');
      assert.equal(getPublishedPage(root.id, workspace), null);
      assert.throws(() => publishPage(child.id, 'public', workspace), /parent pages/i);

      const firstSnapshot = publishPage(root.id, 'public', workspace);
      assert.equal(firstSnapshot.bodyMarkdown, 'Draft one\n');
      publishPage(child.id, 'unlisted', workspace);
      assert.equal(listPublishedPages(false, workspace).some((page) => page.id === child.id), false);
      assert.equal(listPublishedPages(true, workspace).some((page) => page.id === child.id), true);

      updatePage(root.id, { revision: root.revision, title: 'Changed draft', bodyMarkdown: 'Draft two\n' }, workspace);
      assert.equal(getPublishedPage(root.id, workspace)?.title, 'Private root');
      assert.equal(getPublishedPage(root.id, workspace)?.bodyMarkdown, 'Draft one\n');
      assert.throws(() => unpublishPage(root.id, workspace), /child pages/i);
      unpublishPage(child.id, workspace);
      unpublishPage(root.id, workspace);
      assert.equal(getPublishedPage(root.id, workspace), null);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('page URLs', () => {
  it('builds clean root-based public page paths', () => {
    const root = { id: 'root', parentId: null, sortKey: 0, title: 'Root Page' };
    const child = { id: 'child', parentId: 'root', sortKey: 1, title: 'Child Page' };

    assert.equal(buildPagePathFromPages(root.id, [root, child]), '/root-page');
    assert.equal(buildPagePathFromPages(child.id, [root, child]), '/root-page/child-page');
    assert.equal(buildPagePathFromPages(child.id, [root, child], '/page'), '/page/root-page/child-page');
    assert.equal(toPublicPath('/page/root-page/child-page'), '/root-page/child-page');
    assert.equal(toPublicPath('/published/root-page/child-page'), '/root-page/child-page');
    assert.equal(toPublicPath('/published/collections/books'), '/collections/books');
  });
});

describe('pages CRUD and ordering', () => {
  it('supports create, update, conflict checks, move and reorder', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    const root = createPage({ title: 'Root page', tags: ['anchor', 'draft'] }, workspace);
    const childA = createPage({ title: 'Child A', parentId: root.id, tags: ['review'] }, workspace);
    const childB = createPage({ title: 'Child B', parentId: root.id }, workspace);

    assert.equal(listPages(workspace).length, 3);

    const loaded = getPage(root.id, workspace);
    assert.equal(loaded?.revision, 0);
    assert.equal(loaded?.kind, 'note');
    assert.deepEqual(loaded?.tags, ['anchor', 'draft']);

    const updated = updatePage(
      childA.id,
      {
        revision: childA.revision,
        title: 'Renamed Child A',
        bodyMarkdown: 'Hello\n',
        coverFocalX: 12,
        coverFocalY: 88,
        kind: 'article',
        tags: ['edited', 'review', 'review'],
      },
      workspace,
    );
    assert.equal(updated.title, 'Renamed Child A');
    assert.equal(updated.coverFocalX, 12);
    assert.equal(updated.coverFocalY, 88);
    assert.equal(updated.kind, 'article');
    assert.deepEqual(updated.tags, ['edited', 'review']);

    const reloaded = getPage(childA.id, workspace);
    assert.equal(reloaded?.coverFocalX, 12);
    assert.equal(reloaded?.coverFocalY, 88);
    assert.equal(reloaded?.kind, 'article');
    assert.deepEqual(reloaded?.tags, ['edited', 'review']);

    const duplicated = duplicatePage(childA.id, workspace);
    assert.equal(duplicated?.title, 'Renamed Child A Copy');
    assert.deepEqual(duplicated?.tags, ['edited', 'review']);
    assert.throws(
      () =>
        updatePage(
          childA.id,
          {
            revision: -1,
            title: 'Stale update',
          },
          workspace,
        ),
      (error: unknown) => error instanceof RevisionConflictError,
      'Stale revision should be rejected',
    );

    // Move childB from root-child to root-level and then reorder children.
    const moved = applyPageMoves(
      [
        {
          id: childB.id,
          parentId: null,
          sortKey: 1,
          revision: childB.revision,
        },
        {
          id: childA.id,
          parentId: root.id,
          sortKey: 1,
          revision: childA.revision + 1,
        },
      ],
      workspace,
    );
    assert.equal(moved.length, 2);

    const current = listPages(workspace);
    const rootChilds = current.filter((page) => page.parentId === root.id);
    assert.equal(rootChilds.length, 2);
    assert.equal(rootChilds.some((page) => page.id === childA.id), true);
    assert.equal(rootChilds.some((page) => page.id === duplicated?.id), true);

    const rootLevel = current.filter((page) => page.parentId === null);
    assert.equal(rootLevel.some((page) => page.id === childB.id), true);

    // Reorder root level with stable ids.
    const rootLevelPages = current.filter((page) => page.parentId === null).sort((a, b) => a.sortKey - b.sortKey);
    const reordered = applyPageMoves(
      rootLevelPages.map((page, index) => ({
        id: page.id,
        parentId: page.parentId,
        sortKey: index,
        revision: page.revision,
      })),
      workspace,
    );
    assert.ok(reordered.length);

    trashPage(root.id, workspace);
    assert.equal(listPages(workspace).find((page) => page.id === root.id), undefined);

    const restored = restorePage(root.id, workspace);
    assert.equal(restored?.id, root.id);

    const db = createStorageConnection(workspace);
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('records hidden slug aliases when pages are renamed or moved', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-alias-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    try {
      const root = createPage({ title: 'Arcana' }, workspace);
      const child = createPage({ title: 'Sigils', parentId: root.id }, workspace);
      const grandchild = createPage({ title: 'Daily Notes', parentId: child.id }, workspace);
      const originalPages = listPages(workspace);
      const originalChildPath = buildPagePathFromPages(child.id, originalPages);
      const originalGrandchildPath = buildPagePathFromPages(grandchild.id, originalPages);

      const renamed = updatePage(child.id, { revision: child.revision, title: 'Sigil Archive' }, workspace);
      const afterRenamePages = listPages(workspace);
      const renamedChildResolution = resolvePageRoutePath(originalChildPath.replace(/^\//, '').split('/'), workspace);
      const renamedGrandchildResolution = resolvePageRoutePath(originalGrandchildPath.replace(/^\//, '').split('/'), workspace);
      assert.equal(renamedChildResolution?.pageId, child.id);
      assert.equal(renamedChildResolution?.canonicalPath, buildPagePathFromPages(child.id, afterRenamePages));
      assert.equal(renamedGrandchildResolution?.pageId, grandchild.id);
      assert.equal(renamedGrandchildResolution?.canonicalPath, buildPagePathFromPages(grandchild.id, afterRenamePages));

      const elsewhere = createPage({ title: 'Elsewhere' }, workspace);
      const beforeMovePages = listPages(workspace);
      const beforeMovePath = buildPagePathFromPages(child.id, beforeMovePages);
      applyPageMoves([
        {
          id: child.id,
          parentId: elsewhere.id,
          sortKey: 1,
          revision: renamed.revision,
        },
      ], workspace);
      const afterMovePages = listPages(workspace);
      const movedResolution = resolvePageRoutePath(beforeMovePath.replace(/^\//, '').split('/'), workspace);
      assert.equal(movedResolution?.pageId, child.id);
      assert.equal(movedResolution?.canonicalPath, buildPagePathFromPages(child.id, afterMovePages));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('resolves manually registered legacy page path aliases', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-manual-alias-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    try {
      const root = createPage({ title: 'Matrix' }, workspace);
      const page = createPage({ title: 'The Anatomy of AI Agents', parentId: root.id, kind: 'article' }, workspace);
      registerPagePathAlias('/posts/ai/the-anatomy-of-ai-agents/', page.id, workspace);
      registerPagePathAlias('posts/ai_learning/the-anatomy-of-ai-agents', page.id, workspace);

      const primaryResolution = resolvePageRoutePath(['posts', 'ai', 'the-anatomy-of-ai-agents'], workspace);
      const aliasResolution = resolvePageRoutePath(['posts', 'ai_learning', 'the-anatomy-of-ai-agents'], workspace);
      assert.equal(primaryResolution?.pageId, page.id);
      assert.equal(aliasResolution?.pageId, page.id);
      assert.equal(primaryResolution?.canonicalPath, buildPagePathFromPages(page.id, listPages(workspace)));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('prevents cyclic hierarchy moves', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    const parent = createPage({ title: 'Parent' }, workspace);
    const child = createPage({ title: 'Child', parentId: parent.id }, workspace);
    const grandchild = createPage({ title: 'Grandchild', parentId: child.id }, workspace);

    assert.throws(
      () =>
        applyPageMoves(
          [
            {
              id: parent.id,
              parentId: grandchild.id,
              sortKey: 1,
              revision: parent.revision,
            },
          ],
          workspace,
        ),
      (error: unknown) => error instanceof Error,
    );

    // Attempting to move child under its own grandchild through multi-move should also fail.
    assert.throws(
      () =>
        applyPageMoves(
          [
            {
              id: child.id,
              parentId: grandchild.id,
              sortKey: 1,
              revision: child.revision,
            },
            {
              id: grandchild.id,
              parentId: child.id,
              sortKey: 1,
              revision: grandchild.revision,
            },
          ],
          workspace,
        ),
      (error: unknown) => error instanceof Error,
    );

    // Updating a page to create cycle should fail.
    assert.throws(
      () =>
        updatePage(parent.id, {
          revision: parent.revision,
          parentId: grandchild.id,
          title: 'Parent',
        }, workspace),
      (error: unknown) => error instanceof Error,
    );

    rmSync(workspace, { recursive: true, force: true });
  });

  it('extracts links for backlink indexing', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    const root = createPage({ title: 'Root' }, workspace);
    const target = createPage({ title: 'Target', parentId: root.id }, workspace);
    const source = createPage({
      title: 'Source',
      parentId: root.id,
      bodyMarkdown: `intro\n\n[Target](arcane://page/${target.id})\n`,
    }, workspace);

    const ids = extractLinkedPageIds(source.bodyMarkdown);
    assert.equal(ids.includes(target.id), true);

    const backlinksAfterCreate = readBacklinks(target.id, workspace);
    assert.equal(backlinksAfterCreate.length, 1);
    assert.equal(backlinksAfterCreate[0].id, source.id);

    const duplicate = duplicatePage(source.id, workspace);
    assert.ok(duplicate);
    const backlinksAfterDuplicate = readBacklinks(target.id, workspace);
    assert.equal(backlinksAfterDuplicate.length, 2);

    rmSync(workspace, { recursive: true, force: true });
  });
});

it('opens a SQLite handle from workspace path', () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
  ensureWorkspaceDirs(workspace);
  openWorkspace({ dataDir: workspace });
  const conn = createStorageConnection(workspace);
  conn.close();
  assert.equal(existsSync(getWorkspaceDbPath(workspace)), true);
  rmSync(workspace, { recursive: true, force: true });
});
