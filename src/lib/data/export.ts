import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import { getWorkspaceAssetsDir } from './workspace';
import { listCollectionItems, listCollectionPages, getSettings, listPages, readBacklinks, listAssets } from './storage';
import { getAssetPathFromId } from './storage';
import type { CollectionItemRecord, PageRecord } from './types';

function rewriteLinks(contentJson: string): string {
  if (!contentJson) {
    return '';
  }

  try {
    const parsed = JSON.parse(contentJson) as unknown;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') {
        return;
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }
        return;
      }

      const record = node as Record<string, unknown>;
      if (typeof record.pageId === 'string' && record.content === undefined) {
        record.url = `./${record.pageId}.md`;
      }
      if (typeof record.content === 'string') {
        record.content = record.content.replace(/\(\/[Pp]age\/(.*?)\)/g, (_m, pageId) => {
          if (typeof pageId === 'string') {
            return `(./${pageId}.md)`;
          }
          return _m;
        });
      }
      if (record.children) {
        walk(record.children);
      }
      if (record.text && typeof record.text === 'string') {
        record.text = record.text;
      }
    };
    walk(parsed);
    return JSON.stringify(parsed);
  } catch {
    return contentJson;
  }
}

function toMarkdown(page: PageRecord): string {
  let body = '';
  try {
    const parsed = JSON.parse(page.contentJson) as unknown;
    if (Array.isArray(parsed)) {
      body = parsed
        .map((block) => blockToMarkdown(block))
        .filter(Boolean)
        .join('\n\n');
    } else if (typeof parsed === 'string') {
      body = parsed;
    }
  } catch {
    body = page.contentJson ?? '';
  }

  const frontmatter = [
    '---',
    `id: ${page.id}`,
    `title: ${escapeYamlValue(page.title)}`,
    `parent_id: ${page.parentId ?? 'null'}`,
    `icon: ${page.icon ?? 'null'}`,
    `cover_asset_id: ${page.coverAssetId ?? 'null'}`,
    `revision: ${page.revision}`,
    `created_at: ${new Date(page.createdAt).toISOString()}`,
    `updated_at: ${new Date(page.updatedAt).toISOString()}`,
    '---',
    '',
  ].join('\n');

  const backlinks = readBacklinks(page.id);
  const backlinkSummary =
    backlinks.length > 0
      ? `\n\n## Backlinks\n\n${backlinks.map((pageLink) => `- [[${pageLink.title}]](${pageLink.id}.md)`).join('\n')}`
      : '';

  return `${frontmatter}${body}${backlinkSummary}`;
}

function escapeYamlValue(value: string): string {
  if (!value) {
    return '""';
  }
  const needsQuote = /[:#\n\r'\"]/g.test(value);
  return needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function blockToMarkdown(block: unknown): string {
  if (!block || typeof block !== 'object') {
    return '';
  }
  const record = block as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  const text = typeof record.text === 'string' ? record.text : '';
  const content = rewriteLinks(JSON.stringify(block));

  if (!type) {
    return text;
  }

  switch (type) {
    case 'heading':
      return `${'#'.repeat((typeof record.level === 'number' ? record.level : 1) ?? 1)} ${text}`;
    case 'paragraph':
      return text;
    case 'quote':
      return `> ${text}`;
    case 'todo':
      return `- [ ] ${text}`;
    case 'callout':
      return `> ${text}`;
    case 'image':
      return `![asset](${typeof record.url === 'string' ? record.url : ''})`;
    case 'link':
      return `[${text}](${typeof record.href === 'string' ? record.href : ''})`;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    default:
      return content ? `<!-- unsupported-block:${type} -->\n${content}` : text;
  }
}

function collectionToCsv(collection: { id: string; name: string }, items: CollectionItemRecord[]): string {
  const header = ['page_id', 'properties'];
  const rows = [
    header.join(','),
    ...items.map((item) => {
      const propertyText = item.propertiesJson.replaceAll('"', '""');
      return `${item.pageId},"${propertyText}"`;
    }),
  ];
  return rows.join('\n');
}

function addAssetArchiveEntries(zip: ReturnType<typeof archiver>, dataDir?: string): void {
  const assets = listAssets(dataDir);
  for (const asset of assets) {
    const assetPath = getAssetPathFromId(asset.id, dataDir);
    if (!existsSync(assetPath)) {
      continue;
    }
    zip.file(assetPath, { name: `assets/${asset.id}${path.extname(asset.filename)}` });
  }
}

export function exportWorkspaceZip(dataDir?: string): string {
  const zipName = `arcane-codex-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  const zipPath = path.join(tmpdir(), zipName);
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const pages = listPages(dataDir);
  const collections = listCollectionPages();

  archive.pipe(output);

  for (const page of pages) {
    archive.append(toMarkdown(page), { name: `pages/${page.id}.md` });
  }

  for (const collection of collections) {
    const items = listCollectionItems(collection.id, dataDir);
    const safeName = collection.name.replaceAll(/[^a-zA-Z0-9_-]+/g, '_') || 'collection';
    archive.append(collectionToCsv(collection, items), {
      name: `collections/${collection.id}-${safeName}.csv`,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    workspace: getSettings(dataDir),
    pages: pages.map((item) => ({
      id: item.id,
      title: item.title,
      parentId: item.parentId,
      sortKey: item.sortKey,
      revision: item.revision,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      icon: item.icon,
      coverAssetId: item.coverAssetId,
    })),
  };

  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' });
  addAssetArchiveEntries(archive, dataDir);

  archive.finalize();
  return zipPath;
}

export function collectWorkspaceAssetsList(dataDir?: string): string[] {
  const assetDir = getWorkspaceAssetsDir(dataDir);
  if (!existsSync(assetDir)) {
    return [];
  }

  const children = readdirSync(assetDir, { withFileTypes: true });
  return children
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(assetDir, entry.name));
}

export function detectAssetSize(dataDir?: string): number {
  const files = collectWorkspaceAssetsList(dataDir);
  return files.reduce((sum, filePath) => {
    return sum + (statSync(filePath)?.size ?? 0);
  }, 0);
}
