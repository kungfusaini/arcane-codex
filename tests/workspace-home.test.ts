import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspacePagePathFromPages, getWorkspaceHomePath, getWorkspaceTopLevelPages, promoteWorkspaceHomeChildren, resolveWorkspacePagePathSegments } from '../src/lib/workspaceHome';

const pages = [
  { id: 'home', parentId: null, sortKey: 1, title: 'Arcane Codex', slug: 'arcane-codex' },
  { id: 'child', parentId: 'home', sortKey: 1, title: 'Child', slug: 'child' },
  { id: 'grandchild', parentId: 'child', sortKey: 1, title: 'Grandchild', slug: 'grandchild' },
  { id: 'other', parentId: null, sortKey: 2, title: 'Other', slug: 'other' },
];

test('workspace home path points at the website root', () => {
  assert.equal(getWorkspaceHomePath(pages), '/');
  assert.equal(getWorkspaceHomePath(pages, '/published'), '/published');
  assert.equal(buildWorkspacePagePathFromPages('home', pages), '/');
  assert.equal(buildWorkspacePagePathFromPages('child', pages), '/child');
  assert.equal(buildWorkspacePagePathFromPages('grandchild', pages), '/child/grandchild');
});

test('workspace path resolver treats hidden home children as root paths', () => {
  assert.equal(resolveWorkspacePagePathSegments([], pages), 'home');
  assert.equal(resolveWorkspacePagePathSegments(['arcane-codex'], pages), 'home');
  assert.equal(resolveWorkspacePagePathSegments(['child'], pages), 'child');
  assert.equal(resolveWorkspacePagePathSegments(['arcane-codex', 'child'], pages), 'child');
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
  assert.deepEqual(
    getWorkspaceTopLevelPages(pages).map((page) => ({ id: page.id, parentId: page.parentId })),
    [
      { id: 'child', parentId: null },
      { id: 'other', parentId: null },
    ],
  );
  assert.deepEqual(
    getWorkspaceTopLevelPages([
      ...pages,
      { id: 'fresh', parentId: null, sortKey: 3, title: 'Fresh', slug: 'fresh' },
    ]).map((page) => ({ id: page.id, parentId: page.parentId })),
    [
      { id: 'child', parentId: null },
      { id: 'other', parentId: null },
      { id: 'fresh', parentId: null },
    ],
  );
});
