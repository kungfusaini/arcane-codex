import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCustomBlockSpecs,
  customBlockRegistry,
  getCustomSlashMenuItems,
  getYouTubeVideoId,
} from '../src/components/customBlocks';

describe('trusted custom block registry', () => {
  it('registers code-authored blocks in the editor schema', () => {
    const specs = createCustomBlockSpecs({
      referencedPages: new Map(),
      importAssetFromUrl: async () => ({ id: 'asset', filename: 'asset.png' }),
      uploadAssetRecord: async () => ({ id: 'asset', filename: 'asset.png' }),
    });

    assert.ok(specs.pageLink);
    assert.equal(specs.pageLink.config.type, 'pageLink');
    assert.ok(specs.youtube);
    assert.equal(specs.youtube.config.type, 'youtube');
    assert.ok(specs.gallery);
    assert.equal(specs.gallery.config.type, 'gallery');
    assert.equal(specs.gallery.config.propSchema.mode.default, 'grid');
    assert.equal(specs.gallery.config.propSchema.captionMode.default, 'individual');
  });

  it('extracts video ids from supported YouTube URL formats only', () => {
    assert.equal(getYouTubeVideoId('https://www.youtube.com/watch?v=fgT9zGkiLig&list=RDfgT9zGkiLig'), 'fgT9zGkiLig');
    assert.equal(getYouTubeVideoId('https://youtu.be/fgT9zGkiLig?t=5'), 'fgT9zGkiLig');
    assert.equal(getYouTubeVideoId('https://www.youtube.com/shorts/fgT9zGkiLig'), 'fgT9zGkiLig');
    assert.equal(getYouTubeVideoId('https://example.com/watch?v=fgT9zGkiLig'), null);
  });

  it('keeps blocks out of the slash menu unless they opt in', () => {
    const context = {
      editor: undefined as never,
      referencedPages: new Map(),
      insertBlock: () => undefined,
      importAssetFromUrl: async () => ({ id: 'asset', filename: 'asset.png' }),
      uploadAssetRecord: async () => ({ id: 'asset', filename: 'asset.png' }),
    };

    assert.equal(customBlockRegistry.find((registration) => registration.type === 'pageLink')?.slashMenu, undefined);
    const items = getCustomSlashMenuItems(context, 'gallery');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Gallery');
    assert.match(items[0].subtext ?? '', /URL or upload/);

    const youtubeItems = getCustomSlashMenuItems(context, 'youtube');
    assert.equal(youtubeItems.length, 1);
    assert.equal(youtubeItems[0].title, 'YouTube video');
  });
});
