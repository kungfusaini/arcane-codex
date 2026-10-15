import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetIdsFromMarkdown,
  blocksToMarkdown,
  pageIdsFromMarkdown,
  splitMarkdownExtensions,
  validateMarkdown,
} from '../src/lib/documents/markdown';

describe('Arcane Markdown documents', () => {
  it('serializes ordinary blocks as readable Markdown with stable references', () => {
    const pageId = '11111111-1111-4111-8111-111111111111';
    const markdown = blocksToMarkdown([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Notes', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'link', href: `arcane://page/${pageId}`, content: [{ type: 'text', text: 'Related', styles: { bold: true } }] }] },
    ]);

    assert.match(markdown, /^## Notes/m);
    assert.match(markdown, new RegExp(`arcane://page/${pageId}`));
    assert.deepEqual(pageIdsFromMarkdown(markdown), [pageId]);
  });

  it('preserves galleries as readable fallback plus structured extension data', () => {
    const assetId = 'a'.repeat(64);
    const markdown = blocksToMarkdown([{
      type: 'gallery',
      props: {
        images: JSON.stringify([{ url: `/api/assets/${assetId}`, name: 'study.png', caption: 'Study' }]),
        mode: 'grid',
        imageSize: 240,
      },
    }]);

    assert.match(markdown, /!\[Study\]\(arcane:\/\/asset\/sha256:/);
    const segments = splitMarkdownExtensions(markdown);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].type, 'extension');
    if (segments[0].type === 'extension') {
      assert.equal(segments[0].extensionType, 'gallery');
      const props = segments[0].block.props as { images?: unknown };
      assert.ok(Array.isArray(props.images), 'canonical gallery images should be structured data');
    }
    assert.deepEqual(assetIdsFromMarkdown(markdown), [assetId]);
    assert.deepEqual(validateMarkdown(markdown), []);
  });

  it('rejects malformed extension boundaries', () => {
    assert.ok(validateMarkdown('<!-- arcane:begin gallery -->\nbroken').length > 0);
  });
});
