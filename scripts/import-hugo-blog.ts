#!/usr/bin/env tsx
import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import {
  createAsset,
  createCollection,
  createCollectionItem,
  createPage,
  listCollections,
  listCollectionItems,
  listPages,
  registerPagePathAlias,
  updatePage,
  type PageSummaryRecord,
} from '../src/lib/data/storage';
import type { CollectionRecord, PageRecord } from '../src/lib/data/types';

const DEFAULT_HUGO_ROOT = path.join(os.homedir(), 'matrix/web/aether/services/arcanecodex');

type Frontmatter = {
  title: string;
  date?: string;
  draft?: boolean;
  categories?: string;
  tags: string[];
  aliases: string[];
};

type ImportTarget = {
  source: string;
  oldUrls: string[];
  destination:
    | { kind: 'page'; path: string[]; title: string }
    | { kind: 'collection'; collection: 'Books' | 'Cinema'; title: string };
};

type Block = {
  type: string;
  props?: Record<string, unknown>;
  content?: Array<{ type: 'text'; text: string; styles?: Record<string, boolean> } | { type: 'link'; href: string; content: Array<{ type: 'text'; text: string; styles?: Record<string, boolean> }> }>;
};

const IMPORT_TARGETS: ImportTarget[] = [
  {
    source: 'posts/aether/building-aether.md',
    oldUrls: ['/posts/aether/building-aether/'],
    destination: { kind: 'page', path: ['Matrix', 'Aether'], title: 'Building Aether' },
  },
  {
    source: 'posts/aether/nginx-aether.md',
    oldUrls: ['/posts/aether/nginx-aether/'],
    destination: { kind: 'page', path: ['Matrix', 'Aether'], title: 'Nginx Reverse Proxy' },
  },
  {
    source: 'posts/ai/ai-dev-skills.md',
    oldUrls: ['/posts/ai/ai-dev-skills/', '/posts/ai_learning/ai-dev-skills/'],
    destination: { kind: 'page', path: ['Matrix', 'AI'], title: 'The Missing Skills of Vibe Coders' },
  },
  {
    source: 'posts/ai/ai-tech-lead.md',
    oldUrls: ['/posts/ai/ai-tech-lead/'],
    destination: { kind: 'page', path: ['Matrix', 'AI'], title: 'AI Makes You Think Like a Tech Lead' },
  },
  {
    source: 'posts/ai/the-anatomy-of-ai-agents.md',
    oldUrls: ['/posts/ai/the-anatomy-of-ai-agents/', '/posts/ai_learning/the-anatomy-of-ai-agents/'],
    destination: { kind: 'page', path: ['Matrix', 'AI'], title: 'The Anatomy of AI Agents' },
  },
  {
    source: 'posts/ai/the-right-model.md',
    oldUrls: ['/posts/ai/the-right-model/'],
    destination: { kind: 'page', path: ['Matrix', 'AI'], title: 'The Right Model' },
  },
  {
    source: 'posts/culture/books/metamorphosis.md',
    oldUrls: ['/posts/culture/books/metamorphosis/'],
    destination: { kind: 'collection', collection: 'Books', title: 'Metamorphosis' },
  },
  {
    source: 'posts/culture/books/the-alchemist.md',
    oldUrls: ['/posts/culture/books/the-alchemist/'],
    destination: { kind: 'collection', collection: 'Books', title: 'The Alchemist' },
  },
  {
    source: 'posts/culture/movies/the-shining.md',
    oldUrls: ['/posts/culture/movies/the-shining/'],
    destination: { kind: 'collection', collection: 'Cinema', title: 'The Shining' },
  },
  {
    source: 'posts/tech/fixing-markdown-rendering-neovim.md',
    oldUrls: ['/posts/tech/fixing-markdown-rendering-neovim/'],
    destination: { kind: 'page', path: ['Matrix', 'Tools', 'Neovim'], title: 'Markdown Rendering Issue' },
  },
  {
    source: 'posts/thoughts/flexibility.md',
    oldUrls: ['/posts/thoughts/flexibility/'],
    destination: { kind: 'page', path: ['Life'], title: 'The Path to a More Flexible Life' },
  },
  {
    source: 'posts/thoughts/lifechanging-bike.md',
    oldUrls: ['/posts/thoughts/lifechanging-bike/'],
    destination: { kind: 'page', path: ['Life'], title: 'How a Motorcycle Changed My Life' },
  },
  {
    source: 'posts/thoughts/living-free.md',
    oldUrls: ['/posts/thoughts/living-free/'],
    destination: { kind: 'page', path: ['Life'], title: 'Structuring a Free Life' },
  },
  {
    source: 'posts/thoughts/nomad-prep.md',
    oldUrls: ['/posts/thoughts/nomad-prep/'],
    destination: { kind: 'page', path: ['Life'], title: 'Preparing for a Nomadic Life' },
  },
  {
    source: 'posts/thoughts/the-importance-of-having-your-own-tools.md',
    oldUrls: ['/posts/thoughts/the-importance-of-having-your-own-tools/'],
    destination: { kind: 'page', path: ['Matrix', 'Tools'], title: 'The Importance of Having Your Own Tools' },
  },
];

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function parseStringArray(value: string): string[] {
  return [...value.matchAll(/'([^']*)'|"([^"]*)"/g)].map((match) => match[1] ?? match[2]).filter(Boolean);
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const defaults: Frontmatter = { title: 'Untitled', tags: [], aliases: [] };
  if (!raw.startsWith('+++')) {
    return { frontmatter: defaults, body: raw };
  }
  const end = raw.indexOf('\n+++', 3);
  if (end < 0) {
    return { frontmatter: defaults, body: raw };
  }
  const frontmatterRaw = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const frontmatter = { ...defaults };
  for (const line of frontmatterRaw.split('\n')) {
    const match = /^([A-Za-z_]+)\s*=\s*(.+?)\s*$/.exec(line.trim());
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === 'title' || key === 'date' || key === 'categories') {
      const stringMatch = /^['"]([\s\S]*)['"]$/.exec(rawValue.trim());
      (frontmatter as Record<string, unknown>)[key] = stringMatch ? stringMatch[1] : rawValue.trim();
    } else if (key === 'draft') {
      frontmatter.draft = rawValue.trim() === 'true';
    } else if (key === 'tags' || key === 'aliases') {
      (frontmatter as Record<string, unknown>)[key] = parseStringArray(rawValue);
    }
  }
  return { frontmatter, body };
}

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function stripHugoShortcodes(value: string): string {
  return value
    .replaceAll('{{< emph >}}', '*')
    .replaceAll('{{< /emph >}}', '*')
    .replace(/{{<\s*caption\s*>}}/g, '')
    .replace(/{{<\s*\/caption\s*>}}/g, '')
    .replace(/{{<[^>]+>}}/g, '');
}

function captionFromLine(line: string): string | null {
  const match = /^{{<\s*caption\s*>}}\s*(.*?)\s*{{<\s*\/caption\s*>}}$/.exec(line.trim());
  return match ? stripHugoShortcodes(match[1]).trim() : null;
}

function styledTextContent(text: string): Array<{ type: 'text'; text: string; styles: Record<string, boolean> }> {
  const normalized = stripHugoShortcodes(text);
  const parts: Array<{ type: 'text'; text: string; styles: Record<string, boolean> }> = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let index = 0;
  for (const match of normalized.matchAll(pattern)) {
    if (match.index !== undefined && match.index > index) {
      parts.push({ type: 'text', text: normalized.slice(index, match.index), styles: {} });
    }
    if (match[2]) parts.push({ type: 'text', text: match[2], styles: { bold: true } });
    else if (match[3]) parts.push({ type: 'text', text: match[3], styles: { italic: true } });
    else if (match[4]) parts.push({ type: 'text', text: match[4], styles: { code: true } });
    index = (match.index ?? 0) + match[0].length;
  }
  if (index < normalized.length) {
    parts.push({ type: 'text', text: normalized.slice(index), styles: {} });
  }
  return parts.length ? parts : [{ type: 'text', text: normalized, styles: {} }];
}

function inlineContent(text: string): NonNullable<Block['content']> {
  const content: NonNullable<Block['content']> = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index !== undefined && match.index > index) {
      content.push(...styledTextContent(text.slice(index, match.index)));
    }
    content.push({
      type: 'link',
      href: normalizeHref(match[2]),
      content: styledTextContent(match[1]),
    });
    index = (match.index ?? 0) + match[0].length;
  }
  if (index < text.length) {
    content.push(...styledTextContent(text.slice(index)));
  }
  return content.length ? content : [{ type: 'text', text, styles: {} }];
}

function normalizeHref(href: string): string {
  if (/^(https?:|mailto:|#|\/)/i.test(href)) return href;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(href)) return `https://${href}`;
  return href;
}

function paragraphBlock(text: string): Block {
  return { type: 'paragraph', content: inlineContent(stripHugoShortcodes(text).trim()) };
}

function galleryBlock(legacyPath: string, caption: string, assetByLegacyPath: Map<string, string>): Block {
  const assetUrl = assetByLegacyPath.get(legacyPath) ?? legacyPath;
  return {
    type: 'gallery',
    props: {
      images: JSON.stringify([{ url: assetUrl, caption, name: path.basename(legacyPath) }]),
      imageSize: 320,
      mode: 'single',
      captionMode: 'individual',
      groupCaption: '',
    },
  };
}

function noteBlock(text: string): Block {
  return { type: 'quote', content: inlineContent(`Note: ${stripHugoShortcodes(text).trim()}`) };
}

function markdownToBlocks(body: string, assetByLegacyPath: Map<string, string>): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = '';

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push(paragraphBlock(text));
    paragraph = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();
    const fence = /^```\s*(\S*)/.exec(line.trim());
    if (fence) {
      if (code) {
        blocks.push({ type: 'codeBlock', props: { language: codeLanguage }, content: [{ type: 'text', text: code.join('\n'), styles: {} }] });
        code = null;
        codeLanguage = '';
      } else {
        flushParagraph();
        code = [];
        codeLanguage = fence[1] || '';
      }
      continue;
    }
    if (code) {
      code.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', props: { level: heading[1].length }, content: inlineContent(stripHugoShortcodes(heading[2])) });
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(line.trim());
    if (image) {
      flushParagraph();
      const [, alt, legacyPath] = image;
      let caption = alt.trim();
      let lookahead = lineIndex + 1;
      while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
      const shortcodeCaption = lookahead < lines.length ? captionFromLine(lines[lookahead]) : null;
      if (shortcodeCaption !== null) {
        caption = shortcodeCaption;
        lineIndex = lookahead;
      }
      blocks.push(galleryBlock(legacyPath, caption, assetByLegacyPath));
      continue;
    }

    if (line.trim() === 'Note:') {
      flushParagraph();
      let lookahead = lineIndex + 1;
      while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
      const noteLines: string[] = [];
      while (lookahead < lines.length) {
        const quote = /^>\s?(.*)$/.exec(lines[lookahead].trim());
        if (!quote) break;
        noteLines.push(quote[1]);
        lookahead += 1;
      }
      if (noteLines.length) {
        blocks.push(noteBlock(noteLines.join(' ')));
        lineIndex = lookahead - 1;
        continue;
      }
    }

    const quote = /^>\s?(.*)$/.exec(line.trim());
    if (quote) {
      flushParagraph();
      blocks.push({ type: 'quote', content: inlineContent(stripHugoShortcodes(quote[1])) });
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line.trim());
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bulletListItem', content: inlineContent(stripHugoShortcodes(bullet[1])) });
      continue;
    }

    const numbered = /^\d+\.\s+(.+)$/.exec(line.trim());
    if (numbered) {
      flushParagraph();
      blocks.push({ type: 'numberedListItem', content: inlineContent(stripHugoShortcodes(numbered[1])) });
      continue;
    }

    const looseCaption = captionFromLine(line);
    if (looseCaption !== null) {
      flushParagraph();
      blocks.push(paragraphBlock(looseCaption));
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function pageByParentAndTitle(pages: PageSummaryRecord[], parentId: string | null, title: string): PageSummaryRecord | undefined {
  return pages.find((page) => page.parentId === parentId && page.title.trim().toLowerCase() === title.trim().toLowerCase());
}

function findOrCreatePage(title: string, parentId: string | null, contentJson: string, isArticle: boolean, apply: boolean, dataDir?: string): PageRecord | PageSummaryRecord {
  const existing = pageByParentAndTitle(listPages(dataDir), parentId, title);
  if (existing) {
    if (apply) {
      return updatePage(existing.id, { revision: existing.revision, contentJson, isArticle }, dataDir);
    }
    return existing;
  }
  if (!apply) {
    return { id: `dry-${parentId ?? 'root'}-${title}`, parentId, sortKey: 0, title, slug: title, icon: null, iconAssetId: null, coverAssetId: null, coverFocalX: 50, coverFocalY: 50, coverScale: 100, isArticle, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null };
  }
  return createPage({ title, parentId, contentJson, isArticle }, dataDir);
}

function ensurePath(pathParts: string[], apply: boolean, dataDir?: string): string | null {
  let parentId: string | null = null;
  for (const part of pathParts) {
    const existing = pageByParentAndTitle(listPages(dataDir), parentId, part);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    if (!apply) {
      parentId = `dry-${parentId ?? 'root'}-${part}`;
      continue;
    }
    parentId = createPage({ title: part, parentId, isArticle: false, contentJson: '[]' }, dataDir).id;
  }
  return parentId;
}

function findOrCreateCollection(name: 'Books' | 'Cinema', apply: boolean, dataDir?: string): CollectionRecord {
  const collections = listCollections(dataDir);
  const existing = name === 'Books'
    ? collections.find((collection) => collection.name.toLowerCase().includes('book'))
    : collections.find((collection) => collection.name.toLowerCase() === 'cinema');
  if (existing) return existing;
  if (!apply) {
    return { id: `dry-collection-${name}`, hostPageId: null, name, schemaJson: '{"properties":[]}', viewsJson: '{"mode":"table"}', createdAt: Date.now(), updatedAt: Date.now() };
  }
  return createCollection({
    name,
    schema: name === 'Cinema'
      ? { properties: [
          { id: 'status', name: 'Status', type: 'select', options: ['To watch', 'Watched'] },
          { id: 'tags', name: 'Tags', type: 'multi-select' },
          { id: 'old_url', name: 'Old URL', type: 'url' },
        ] }
      : undefined,
    views: { mode: 'table' },
  }, dataDir);
}

function findCollectionPage(collection: CollectionRecord, title: string, dataDir?: string): PageRecord | undefined {
  const pageById = new Map(listPages(dataDir).map((page) => [page.id, page]));
  return listCollectionItems(collection.id, dataDir)
    .map((item) => pageById.get(item.pageId))
    .find((page): page is PageRecord => Boolean(page && page.title.trim().toLowerCase() === title.trim().toLowerCase()));
}

function importAsset(legacyPath: string, hugoRoot: string, apply: boolean, dataDir?: string): string | null {
  const normalized = legacyPath.replace(/^\//, '');
  const candidates = [path.join(hugoRoot, 'assets', normalized), path.join(hugoRoot, 'static', normalized), path.join(hugoRoot, 'public', normalized)];
  const sourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!sourcePath) return null;
  if (!apply) return `/api/assets/dry-${path.basename(normalized)}`;
  const { asset } = createAsset({ filename: path.basename(sourcePath), mimeType: mimeTypeFor(sourcePath), sourcePath }, dataDir);
  return `/api/assets/${asset.id}`;
}

function buildAssetMap(body: string, hugoRoot: string, apply: boolean, dataDir?: string): Map<string, string> {
  const assetByLegacyPath = new Map<string, string>();
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const legacyPath = match[1];
    const assetUrl = importAsset(legacyPath, hugoRoot, apply, dataDir);
    if (assetUrl) assetByLegacyPath.set(legacyPath, assetUrl);
  }
  return assetByLegacyPath;
}

function registerAliases(oldUrls: string[], pageId: string, apply: boolean, dataDir?: string): void {
  for (const oldUrl of oldUrls) {
    if (apply) registerPagePathAlias(oldUrl, pageId, dataDir);
  }
}

function collectionProperties(target: ImportTarget, fm: Frontmatter): Record<string, unknown> {
  const oldUrl = target.oldUrls[0];
  if (target.destination.kind !== 'collection') return {};
  if (target.destination.collection === 'Books') {
    return { status: 'Finished', tags: fm.tags, old_url: oldUrl };
  }
  return { status: 'Watched', tags: fm.tags, old_url: oldUrl };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const hugoRoot = path.resolve(argValue('--hugo-root') ?? DEFAULT_HUGO_ROOT);
  const dataDir = argValue('--data-dir') ?? process.env.ARCANE_DATA_DIR;

  if (!existsSync(hugoRoot)) {
    throw new Error(`Hugo root not found: ${hugoRoot}`);
  }

  console.log(`${apply ? 'Applying' : 'Dry run'} Hugo import from ${hugoRoot}`);
  if (dataDir) console.log(`Arcane data dir: ${dataDir}`);
  console.log('');

  for (const target of IMPORT_TARGETS) {
    const sourcePath = path.join(hugoRoot, 'content', target.source);
    const raw = readFileSync(sourcePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (frontmatter.draft) {
      console.log(`SKIP draft ${target.source}`);
      continue;
    }

    const assetMap = buildAssetMap(body, hugoRoot, apply, dataDir);
    const contentJson = JSON.stringify(markdownToBlocks(body, assetMap));
    let page: PageRecord | PageSummaryRecord;
    let destinationLabel: string;

    if (target.destination.kind === 'page') {
      const parentId = ensurePath(target.destination.path, apply, dataDir);
      page = findOrCreatePage(target.destination.title, parentId, contentJson, true, apply, dataDir);
      destinationLabel = [...target.destination.path, target.destination.title].join(' / ');
    } else {
      const collection = findOrCreateCollection(target.destination.collection, apply, dataDir);
      const existing = findCollectionPage(collection, target.destination.title, dataDir);
      page = existing
        ? (apply ? updatePage(existing.id, { revision: existing.revision, contentJson, isArticle: true }, dataDir) : existing)
        : findOrCreatePage(target.destination.title, null, contentJson, true, apply, dataDir);
      if (apply && !existing) {
        createCollectionItem({ collectionId: collection.id, pageId: page.id, properties: collectionProperties(target, frontmatter) }, dataDir);
      }
      destinationLabel = `${collection.name} collection / ${target.destination.title}`;
    }

    registerAliases(target.oldUrls, page.id, apply, dataDir);
    console.log(`${apply ? 'IMPORTED' : 'WOULD IMPORT'} ${target.source}`);
    console.log(`  -> ${destinationLabel}`);
    console.log(`  old URLs: ${target.oldUrls.join(', ')}`);
    if (assetMap.size) console.log(`  assets: ${[...assetMap.keys()].join(', ')}`);
  }

  console.log('');
  console.log(apply ? 'Import complete.' : 'Dry run complete. Re-run with --apply to mutate the Arcane workspace.');
}

main();
