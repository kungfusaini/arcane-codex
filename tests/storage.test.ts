import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyCollectionItemMoves,
  applyPageMoves,
  createCollection,
  createCollectionItem,
  createPage,
  createStorageConnection,
  getPage,
  listCollectionItems,
  listPages,
  openWorkspace,
  restorePage,
  trashPage,
  updateCollection,
  updateCollectionItemProperties,
  updatePage,
} from '../src/lib/data/storage';
import { RevisionConflictError } from '../src/lib/data/types';
import {
  ensureWorkspaceDirs,
  getWorkspaceAssetsDir,
  getWorkspaceTrashDir,
  getWorkspaceDbPath,
} from '../src/lib/data/workspace';

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

    const list = listCollectionItems(collection.id, workspace);
    assert.equal(list.length, 2);

    const updated = updateCollectionItemProperties(
      {
        collectionId: collection.id,
        pageId: firstItem.pageId,
        properties: { progress: 92 },
      },
      workspace,
    );
    assert.equal(typeof JSON.parse(updated.propertiesJson).progress, 'number');

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
    assert.equal(collectionUpdated.schemaJson.includes('Blocked'), true);
    rmSync(workspace, { recursive: true, force: true });
  });
});

describe('pages CRUD and ordering', () => {
  it('supports create, update, conflict checks, move and reorder', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
    ensureWorkspaceDirs(workspace);
    openWorkspace({ dataDir: workspace });

    const root = createPage({ title: 'Root page' }, workspace);
    const childA = createPage({ title: 'Child A', parentId: root.id }, workspace);
    const childB = createPage({ title: 'Child B', parentId: root.id }, workspace);

    assert.equal(listPages(workspace).length, 3);

    const loaded = getPage(root.id, workspace);
    assert.equal(loaded?.revision, 0);

    const updated = updatePage(
      childA.id,
      {
        revision: childA.revision,
        title: 'Renamed Child A',
        contentJson: '[{"type":"paragraph","content":"Hello"}]',
      },
      workspace,
    );
    assert.equal(updated.title, 'Renamed Child A');

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
    assert.equal(rootChilds.length, 1);
    assert.equal(rootChilds[0].id, childA.id);

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
