import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createAsset,
  createCollection,
  createCollectionItem,
  createPage,
} from '../src/lib/data/storage';
import { buildWorkspaceExport, exportWorkspaceZip } from '../src/lib/data/export';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';
import { buildPagePathFromPages } from '../src/lib/pageUrls';

function entryText(entries: ReturnType<typeof buildWorkspaceExport>['entries'], name: string): string {
  const entry = entries.find((candidate) => candidate.path === name);
  assert.ok(entry, `expected export entry ${name}`);
  return Buffer.isBuffer(entry.data) ? entry.data.toString('utf8') : entry.data;
}

describe('workspace export', () => {
  it('builds deterministic Markdown, assets, collection indexes and CSV, warnings, and ZIP bytes', async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-export-'));
    ensureWorkspaceDirs(workspace);

    try {
      const assetSource = path.join(workspace, 'source.png');
      writeFileSync(assetSource, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const { asset } = createAsset({ filename: 'Cover image.png', mimeType: 'image/png', sourcePath: assetSource }, workspace);

      const target = createPage({ title: 'Target page' }, workspace);
      const missingId = '11111111-1111-4111-8111-111111111111';
      const contentJson = JSON.stringify([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ', styles: {} },
            { type: 'link', href: buildPagePathFromPages(target.id, [target]), content: [{ type: 'text', text: 'Target page', styles: {} }] },
            { type: 'text', text: ' and ', styles: {} },
            { type: 'link', href: `/page/${missingId}`, content: [{ type: 'text', text: 'lost page', styles: {} }] },
          ],
        },
        { type: 'gallery', props: { images: JSON.stringify([{ url: `/api/assets/${asset.id}`, caption: 'Cover image', name: 'Cover image.png' }]), columns: 3, mode: 'single', captionMode: 'individual', groupCaption: '', width: 100 } },
        { type: 'futureWidget', content: [{ type: 'text', text: 'Readable fallback', styles: {} }] },
      ]);
      const source = createPage({ title: 'Source / Notes', coverAssetId: asset.id, coverFocalX: 20, coverFocalY: 80, coverScale: 150, tags: ['research', 'draft'], contentJson }, workspace);

      const collection = createCollection({
        name: 'Projects & plans',
        schema: { properties: [{ id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] }] },
      }, workspace);
      createCollectionItem({
        collectionId: collection.id,
        pageId: target.id,
        properties: { status: 'Done' },
      }, workspace);

      const first = buildWorkspaceExport(workspace);
      const second = buildWorkspaceExport(workspace);
      assert.deepEqual(first, second);
      assert.deepEqual(first.entries.map((entry) => entry.path), [...first.entries.map((entry) => entry.path)].sort());

      const sourceEntry = first.manifest.pages.find((page) => page.id === source.id);
      const targetEntry = first.manifest.pages.find((page) => page.id === target.id);
      assert.ok(sourceEntry && targetEntry);
      const markdown = entryText(first.entries, sourceEntry.path);
      assert.match(markdown, new RegExp(`\\(\\./${path.posix.basename(targetEntry.path).replaceAll('.', '\\.')}\\)`));
      assert.match(markdown, /\.\.\/assets\//);
      assert.match(markdown, /lost page _\(missing page:/);
      assert.match(markdown, /Readable fallback/);
      assert.match(markdown, /cover_focal_x: 20/);
      assert.match(markdown, /cover_focal_y: 80/);
      assert.match(markdown, /cover_scale: 150/);
      assert.match(markdown, /tags: \["research","draft"\]/);
      assert.match(markdown, /Unsupported Arcane Codex block: futureWidget/);

      const collectionEntry = first.manifest.collections[0];
      const csv = entryText(first.entries, collectionEntry.path);
      assert.match(csv, /"page_id","page_title","sort_key","Status"/);
      assert.match(csv, /"Target page"/);
      assert.match(csv, /"Done"/);
      const collectionIndex = entryText(first.entries, collectionEntry.indexPath);
      assert.match(collectionIndex, /^# Projects & plans/m);
      assert.match(collectionIndex, /Structured data \(CSV\)/);
      assert.match(collectionIndex, /Target page/);
      assert.match(collectionIndex, /\.\.\/pages\//);
      assert.ok(first.manifest.warnings.some((warning) => warning.includes(missingId)));
      assert.ok(first.manifest.warnings.some((warning) => warning.includes('futureWidget')));

      const zipOne = await exportWorkspaceZip(workspace);
      const zipTwo = await exportWorkspaceZip(workspace);
      assert.equal(zipOne.buffer.equals(zipTwo.buffer), true, 'same workspace snapshot should produce byte-identical ZIPs');
      assert.equal(zipOne.buffer.subarray(0, 2).toString('ascii'), 'PK');
      assert.deepEqual(zipOne.manifest, first.manifest);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
