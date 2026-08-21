import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkspaceHomePath, promoteWorkspaceHomeChildren } from '../src/lib/workspaceHome';

const pages = [
  { id: 'home', parentId: null, sortKey: 1, title: 'Arcane Codex', slug: 'arcane-codex' },
  { id: 'child', parentId: 'home', sortKey: 1, title: 'Child', slug: 'child' },
  { id: 'grandchild', parentId: 'child', sortKey: 1, title: 'Grandchild', slug: 'grandchild' },
  { id: 'other', parentId: null, sortKey: 2, title: 'Other', slug: 'other' },
];

test('workspace home path points at the arcane-codex root page', () => {
  assert.equal(getWorkspaceHomePath(pages), '/arcane-codex');
  assert.equal(getWorkspaceHomePath(pages, '/published'), '/published/arcane-codex');
});

test('workspace sidebar hides the home root and promotes its children', () => {
  assert.deepEqual(
    promoteWorkspaceHomeChildren(pages).map((page) => ({ id: page.id, parentId: page.parentId })),
    [
      { id: 'child', parentId: null },
      { id: 'grandchild', parentId: 'child' },
      { id: 'other', parentId: null },
    ],
  );
});
