import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';

import * as settingsRoute from '../src/app/api/settings/route';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

function withWorkspace<T>(callback: () => T | Promise<T>): T | Promise<T> {
  const previous = process.env.XDG_DATA_HOME;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-settings-api-'));
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

describe('settings API', () => {
  it('reads and updates published mode', async () => {
    await withWorkspace(async () => {
      const initialRes = await settingsRoute.GET();
      const initial = (await initialRes.json()) as { settings: { publishedMode: boolean } };
      assert.equal(initial.settings.publishedMode, false);

      const patchRes = await settingsRoute.PATCH(
        new NextRequest('http://localhost/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publishedMode: true }),
        }),
      );
      assert.equal(patchRes.status, 200);
      const patched = (await patchRes.json()) as { settings: { publishedMode: boolean } };
      assert.equal(patched.settings.publishedMode, true);
    });
  });
});
