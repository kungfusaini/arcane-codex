import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

import * as assetsRoute from '../src/app/api/assets/route';
import * as assetsImportRoute from '../src/app/api/assets/import/route';
import * as collectionsRoute from '../src/app/api/collections/route';
import * as imageEditRoute from '../src/app/api/image-edit/route';
import * as imageGenerateRoute from '../src/app/api/image-generate/route';
import * as iconGenerateRoute from '../src/app/api/page-icon-generate/route';
import * as pageRestoreRoute from '../src/app/api/pages/[id]/restore/route';
import * as pageRoute from '../src/app/api/pages/[id]/route';
import * as pagesRoute from '../src/app/api/pages/route';
import * as pagesReorderRoute from '../src/app/api/pages/reorder/route';
import * as settingsRoute from '../src/app/api/settings/route';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

function withPublishedWorkspace<T>(callback: () => Promise<T>): Promise<T> {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousSurface = process.env.ARCANE_APP_SURFACE;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-published-guards-'));
  ensureWorkspaceDirs(dataDir);
  process.env.XDG_DATA_HOME = dataDir;
  process.env.ARCANE_APP_SURFACE = 'published';

  return callback().finally(() => {
    process.env.XDG_DATA_HOME = previousDataHome;
    process.env.ARCANE_APP_SURFACE = previousSurface;
    rmSync(dataDir, { recursive: true, force: true });
  });
}

describe('published surface guards', () => {
  it('blocks all mutating routes when the app surface is published', async () => {
    await withPublishedWorkspace(async () => {
      const cases = [
        ['settings patch', () => settingsRoute.PATCH(new NextRequest('http://localhost/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publishedMode: true }),
        }))],
        ['create page', () => pagesRoute.POST(new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Blocked' }),
        }))],
        ['edit page', () => pageRoute.PATCH(new NextRequest('http://localhost/api/pages/abc', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: 0, title: 'Blocked' }),
        }), { params: { id: 'abc' } })],
        ['trash page', () => pageRoute.DELETE(new NextRequest('http://localhost/api/pages/abc', { method: 'DELETE' }), { params: { id: 'abc' } })],
        ['duplicate page', () => pageRoute.POST(new NextRequest('http://localhost/api/pages/abc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'duplicate' }),
        }), { params: { id: 'abc' } })],
        ['restore page', () => pageRestoreRoute.POST(new NextRequest('http://localhost/api/pages/abc/restore', { method: 'POST' }), { params: { id: 'abc' } })],
        ['reorder pages', () => pagesReorderRoute.POST(new NextRequest('http://localhost/api/pages/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ moves: [{ id: 'abc', parentId: null, sortKey: 0, revision: 0 }] }),
        }))],
        ['create collection', () => collectionsRoute.POST(new NextRequest('http://localhost/api/collections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Blocked' }),
        }))],
        ['edit collection', () => collectionsRoute.PATCH(new NextRequest('http://localhost/api/collections', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'abc', name: 'Blocked' }),
        }))],
        ['upload asset', () => assetsRoute.POST(new NextRequest('http://localhost/api/assets', {
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=----test' },
          body: '------test--',
        }))],
        ['import asset', () => assetsImportRoute.POST(new NextRequest('http://localhost/api/assets/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/image.png' }),
        }))],
        ['generate page icon', () => iconGenerateRoute.POST(new NextRequest('http://localhost/api/page-icon-generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'blocked' }),
        }))],
        ['generate image', () => imageGenerateRoute.POST(new NextRequest('http://localhost/api/image-generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'blocked' }),
        }))],
        ['edit image', () => imageEditRoute.POST(new NextRequest('http://localhost/api/image-edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'blocked', image: 'data:image/png;base64,AAAA' }),
        }))],
      ] as const;

      for (const [label, run] of cases) {
        const response = await run();
        assert.equal(response.status, 403, label);
      }
    });
  });
});
