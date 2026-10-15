import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import * as discoveryRoute from '../src/app/api/discovery/route';
import { createCollection, createCollectionItem, createPage } from '../src/lib/data/storage';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

async function withWorkspace(callback: () => Promise<void>) {
  const previous = process.env.XDG_DATA_HOME;
  const base = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-discovery-'));
  ensureWorkspaceDirs(base);
  process.env.XDG_DATA_HOME = base;
  try { await callback(); }
  finally { process.env.XDG_DATA_HOME = previous; rmSync(base, { recursive: true, force: true }); }
}

describe('homepage discovery API', () => {
  it('separates projects, finished writing, and collection shelves', async () => {
    await withWorkspace(async () => {
      const project = createPage({ title: 'Emoji project', bodyMarkdown: '![Body image](https://example.test/body.png)\n\nA visual experiment.', kind: 'project' });
      const article = createPage({ title: 'Finished essay', bodyMarkdown: 'A complete argument.', kind: 'article' });
      const song = createPage({ title: 'A song note', bodyMarkdown: 'Listening notes.' });
      const projects = createCollection({ name: 'Projects', schema: { properties: [{ id: 'summary', name: 'Summary', type: 'text' }] }, views: { mode: 'gallery' } });
      const jukebox = createCollection({ name: 'Jukebox', views: { mode: 'gallery' } });
      createCollectionItem({ collectionId: projects.id, pageId: project.id, properties: { summary: 'A featured project.' } });
      createCollectionItem({ collectionId: jukebox.id, pageId: song.id, properties: {} });

      const response = await discoveryRoute.GET(new NextRequest('http://localhost/api/discovery'));
      assert.equal(response.status, 200);
      const payload = await response.json() as { projects: { cards: Array<{ title: string; summary: string; coverAssetId: string | null; imageUrl?: string }> }; articles: Array<{ title: string }>; shelves: Array<{ name: string; cards: Array<{ title: string }> }> };
      assert.deepEqual(payload.projects.cards.map((card) => [card.title, card.summary]), [['Emoji project', 'A featured project.']]);
      assert.equal(payload.projects.cards[0]?.coverAssetId, null);
      assert.equal(Object.hasOwn(payload.projects.cards[0]!, 'imageUrl'), false);
      assert.deepEqual(payload.articles.map((card) => card.title), ['Finished essay']);
      assert.deepEqual(payload.shelves.map((section) => [section.name, section.cards[0]?.title]), [['Jukebox', 'A song note']]);
    });
  });
});
