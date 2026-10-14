import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

import * as pageRoute from '../src/app/api/pages/[id]/route';
import * as pagesRoute from '../src/app/api/pages/route';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function withWorkspace<T>(callback: () => Promise<T>): Promise<T> {
  const previous = process.env.XDG_DATA_HOME;
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-flow-'));
  ensureWorkspaceDirs(workspace);
  process.env.XDG_DATA_HOME = workspace;

  return callback().finally(() => {
    process.env.XDG_DATA_HOME = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
}

async function saveWithRecovery(pageId: string, revision: number, contentJson: string, title: string) {
  const first = await pageRoute.PATCH(
    new NextRequest(`http://localhost/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision, title, contentJson }),
    }),
    { params: { id: pageId } },
  );

  if (first.status === 409) {
    const latest = await pageRoute.GET(new NextRequest(`http://localhost/api/pages/${pageId}`), {
      params: { id: pageId },
    });
    const latestPayload = (await json(latest)) as { page: { revision: number } };

    const retry = await pageRoute.PATCH(
      new NextRequest(`http://localhost/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: latestPayload.page.revision, title, contentJson }),
      }),
      { params: { id: pageId } },
    );

    if (!retry.ok) {
      throw new Error(`Recovery save failed with ${retry.status}`);
    }
    return retry;
  }

  return first;
}


describe('editor flow scenarios', () => {
  it('recovers from stale revision and preserves restart-safe content', async () => {
    await withWorkspace(async () => {
      const createRes = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Flow page', contentJson: '[{"type":"paragraph","content":"Start"}]' }),
        }),
      );
      const created = (await json(createRes)) as { page: { id: string; revision: number } };

      const staleRevision = created.page.revision;

      const first = await pageRoute.PATCH(
        new NextRequest(`http://localhost/api/pages/${created.page.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            revision: staleRevision,
            title: 'Flow page',
            contentJson: '[{"type":"paragraph","content":"Interim"}]',
          }),
        }),
        { params: { id: created.page.id } },
      );
      assert.equal(first.status, 200);

      const latestBeforeRestart = await pageRoute.GET(
        new NextRequest(`http://localhost/api/pages/${created.page.id}`),
        { params: { id: created.page.id } },
      );
      const loaded = (await json(latestBeforeRestart)) as { page: { revision: number } };

      // Simulate restart by re-reading then saving from stale buffer.
      const recovered = await saveWithRecovery(
        created.page.id,
        staleRevision,
        '[{"type":"paragraph","content":"Recovered"}]',
        'Flow page',
      );
      assert.equal(recovered.status, 200);

      const afterRecovery = await pageRoute.GET(
        new NextRequest(`http://localhost/api/pages/${created.page.id}`),
        { params: { id: created.page.id } },
      );
      const restartedPayload = (await json(afterRecovery)) as {
        page: { contentJson: string; revision: number; title: string };
      };

      assert.equal(restartedPayload.page.title, 'Flow page');
      assert.equal(restartedPayload.page.contentJson, '[{"type":"paragraph","content":"Recovered"}]');
      assert.equal(restartedPayload.page.revision, loaded.page.revision + 1);
    });
  });
});
