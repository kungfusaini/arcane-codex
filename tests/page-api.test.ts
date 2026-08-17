import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';

import * as pagesRoute from '../src/app/api/pages/route';
import * as pageRoute from '../src/app/api/pages/[id]/route';
import * as reorderRoute from '../src/app/api/pages/reorder/route';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

type AnyPayload = { [key: string]: unknown };

async function callJson(response: Response): Promise<AnyPayload> {
  return (await response.json()) as AnyPayload;
}

function withWorkspace<T>(callback: () => T | Promise<T>): T | Promise<T> {
  const previous = process.env.XDG_DATA_HOME;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-api-'));
  ensureWorkspaceDirs(dataDir);
  process.env.XDG_DATA_HOME = dataDir;
  const cleanup = () => {
    process.env.XDG_DATA_HOME = previous;
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe('page API endpoints', () => {
  it('create, edit, refresh, and restart-safe recover', async () => {
    await withWorkspace(async () => {
      const createRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Restart-safe page' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const created = (await callJson(createRes)) as {
        page: { id: string; revision: number; contentJson: string; title: string };
      };
      assert.equal(created.page.title, 'Restart-safe page');

      const getRes1 = await pageRoute.GET(new NextRequest(`http://localhost/api/pages/${created.page.id}`), {
        params: { id: created.page.id },
      });
      const loaded = (await callJson(getRes1)) as { page: { id: string; revision: number; contentJson: string } };
      assert.equal(loaded.page.id, created.page.id);
      assert.equal(loaded.page.revision, created.page.revision);

      const contentJson = '[{"type":"paragraph","content":"checkpoint"}]';
      const patchRes = await pageRoute.PATCH(
        new NextRequest(`http://localhost/api/pages/${created.page.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            revision: loaded.page.revision,
            contentJson,
            title: 'Restart-safe page',
          }),
        }),
        { params: { id: created.page.id } },
      );
      const patched = (await callJson(patchRes)) as {
        page: { id: string; revision: number; contentJson: string; title: string };
      };
      assert.equal(patched.page.contentJson, contentJson);
      assert.equal(patched.page.title, 'Restart-safe page');

      // Simulate restart by refetching page from storage.
      const getRes2 = await pageRoute.GET(new NextRequest(`http://localhost/api/pages/${created.page.id}`), {
        params: { id: created.page.id },
      });
      const reloaded = (await callJson(getRes2)) as { page: { contentJson: string } };
      assert.equal(reloaded.page.contentJson, contentJson);
    });
  });

  it('supports tree reorder and duplicate', async () => {
    await withWorkspace(async () => {
      const createRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Root' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const { page } = (await callJson(createRes)) as {
        page: { id: string; revision: number; title: string; sortKey: number };
      };

      const childARes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'A', parentId: page.id }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const childA = (await callJson(childARes)) as { page: { id: string; revision: number; sortKey: number } };

      const childBRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'B', parentId: page.id }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const childB = (await callJson(childBRes)) as { page: { id: string; revision: number; sortKey: number } };

      const reorderRes = await reorderRoute.POST(
        new NextRequest('http://localhost/api/pages/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            moves: [
              { id: childA.page.id, parentId: page.id, sortKey: 2, revision: childA.page.revision },
              { id: childB.page.id, parentId: page.id, sortKey: 1, revision: childB.page.revision },
            ],
          }),
        }),
      );
      const reordered = (await callJson(reorderRes)) as {
        pages: Array<{ id: string; sortKey: number }>;
      };
      assert.equal(reordered.pages.length, 2);
      const response = await pagesRoute.GET(new NextRequest('http://localhost/api/pages'));
      const listed = (await callJson(response)) as { pages: Array<{ id: string; sortKey: number; parentId: string | null; }> };
      const byParent = listed.pages.filter((item) => item.parentId === page.id).sort((a, b) => a.sortKey - b.sortKey);
      assert.equal(byParent.length >= 2, true);
      assert.equal(byParent[0].id, childB.page.id);

      const duplicateRes = await pageRoute.POST(
        new NextRequest(`http://localhost/api/pages/${childA.page.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'duplicate' }),
        }),
        { params: { id: childA.page.id } },
      );
      const duplicated = (await callJson(duplicateRes)) as { page: { id: string; title: string } };
      assert.equal(duplicated.page.title.endsWith(' Copy'), true);
    });
  });

  it('rejects hierarchy cycles from reorder API', async () => {
    await withWorkspace(async () => {
      const rootRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Root' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const root = (await callJson(rootRes)) as { page: { id: string; revision: number } };

      const childRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Child', parentId: root.page.id }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const child = (await callJson(childRes)) as { page: { id: string; revision: number } };

      const grandchildRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Grandchild', parentId: child.page.id }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const grandchild = (await callJson(grandchildRes)) as { page: { id: string; revision: number } };

      const cycleRes = await reorderRoute.POST(
        new NextRequest('http://localhost/api/pages/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            moves: [
              {
                id: child.page.id,
                parentId: grandchild.page.id,
                sortKey: 1,
                revision: child.page.revision,
              },
            ],
          }),
        }),
      );

      assert.equal(cycleRes.status, 400);
    });
  });

  it('returns 409 for stale revision conflict', async () => {
    await withWorkspace(async () => {
      const createRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title: 'Conflicts' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      const { page } = (await callJson(createRes)) as { page: { id: string; revision: number } };

      const first = await pageRoute.PATCH(
        new NextRequest(`http://localhost/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: page.revision, title: 'Updated once' }),
        }),
        { params: { id: page.id } },
      );
      assert.equal(first.status, 200);

      const second = await pageRoute.PATCH(
        new NextRequest(`http://localhost/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: page.revision, title: 'Stale edit' }),
        }),
        { params: { id: page.id } },
      );
      assert.equal(second.status, 409);
      const conflict = (await callJson(second)) as {
        code: string;
        current: { id: string; title: string; revision: number };
        recovery: string;
      };
      assert.equal(conflict.code, 'REVISION_CONFLICT');
      assert.equal(conflict.current.id, page.id);
      assert.equal(conflict.current.title, 'Updated once');
      assert.equal(conflict.current.revision, page.revision + 1);
      assert.match(conflict.recovery, /draft was not applied/i);
    });
  });
});
