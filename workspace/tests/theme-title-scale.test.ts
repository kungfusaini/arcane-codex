import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function declarationsForSelector(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return Array.from(css.matchAll(pattern), (match) => match[1]);
}

describe('theme title scale', () => {
  it('keeps page title tokens aliased to h1 tokens', () => {
    const theme = read('src/styles/theme.css');

    assert.match(theme, /--font-size-h1:\s*var\(--font-size-800\);/);
    assert.match(theme, /--font-size-page-title:\s*var\(--font-size-h1\);/);
    assert.match(theme, /--font-size-h1-compact:\s*var\(--font-size-700\);/);
    assert.match(theme, /--font-size-page-title-compact:\s*var\(--font-size-h1-compact\);/);
  });

  it('uses page-title tokens for editable and document page title rules', () => {
    const css = [
      read('src/styles/workspace.css'),
      read('src/styles/notion-composition.css'),
      read('src/styles/motion-responsive.css'),
      read('docs/theme-specimen.html'),
    ].join('\n');
    const declarations = [
      ...declarationsForSelector(css, '.page-title'),
      ...declarationsForSelector(css, '.doc-title'),
    ];

    assert.ok(declarations.length > 0, 'expected page title CSS rules to be present');

    const fontSizes = declarations
      .map((block) => block.match(/font-size:\s*([^;]+);/)?.[1]?.trim())
      .filter(Boolean);

    assert.ok(fontSizes.length > 0, 'expected page title rules to declare font-size');
    for (const value of fontSizes) {
      assert.match(value, /var\(--font-size-page-title(?:-compact)?\)/);
    }
  });
});
