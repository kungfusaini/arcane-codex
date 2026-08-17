import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getAssetPathFromId,
  getSettings,
  listAssets,
  listCollectionItems,
  listCollections,
  listPages,
  readBacklinks,
} from './storage';
import type {
  AssetRecord,
  CollectionItemRecord,
  CollectionProperty,
  CollectionRecord,
  CollectionSchema,
  PageRecord,
} from './types';

const ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00.000Z');
const EXPORT_FORMAT_VERSION = 1;

type ExportEntry = {
  path: string;
  data: string | Buffer;
};

export type ExportManifest = {
  formatVersion: number;
  snapshotAt: string;
  workspace: {
    name: string;
    schemaVersion: number;
  };
  pages: Array<{
    id: string;
    path: string;
    title: string;
    parentId: string | null;
    revision: number;
    updatedAt: number;
  }>;
  assets: Array<{
    id: string;
    path: string;
    filename: string;
    mimeType: string;
    sha256: string;
    size: number;
    exported: boolean;
  }>;
  collections: Array<{
    id: string;
    path: string;
    indexPath: string;
    name: string;
    itemCount: number;
  }>;
  warnings: string[];
};

export type WorkspaceExport = {
  entries: ExportEntry[];
  manifest: ExportManifest;
  filename: string;
};

type MarkdownContext = {
  page: PageRecord;
  pagePathById: Map<string, string>;
  assetPathById: Map<string, string>;
  assetById: Map<string, AssetRecord>;
  warnings: Set<string>;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function safeFilename(value: string): string {
  const extension = path.extname(value).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = path.basename(value, path.extname(value));
  return `${slug(stem, 'asset')}${extension}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function parseObject(raw: string, warning: string, warnings: Set<string>): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // warning below
  }
  warnings.add(warning);
  return {};
}

function parseSchema(collection: CollectionRecord, warnings: Set<string>): CollectionSchema {
  const parsed = parseObject(
    collection.schemaJson,
    `Collection ${collection.id} has invalid schema JSON; property IDs were used as CSV headers.`,
    warnings,
  );
  return {
    properties: Array.isArray(parsed.properties)
      ? (parsed.properties.filter((property): property is CollectionProperty => Boolean(
          property &&
          typeof property === 'object' &&
          typeof (property as CollectionProperty).id === 'string' &&
          typeof (property as CollectionProperty).name === 'string',
        )))
      : [],
  };
}

function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function relativeLink(fromEntry: string, toEntry: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromEntry), toEntry);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function pageLink(pageId: string, label: string, context: MarkdownContext): string {
  const target = context.pagePathById.get(pageId);
  if (!target) {
    const warning = `Page ${context.page.id} links to missing or trashed page ${pageId}.`;
    context.warnings.add(warning);
    return `${escapeMarkdownText(label || 'Missing page')} _(missing page: ${pageId})_`;
  }
  return `[${escapeMarkdownText(label || pageId)}](${relativeLink(context.pagePathById.get(context.page.id)!, target)})`;
}

function assetLink(assetId: string, label: string, context: MarkdownContext, image: boolean): string {
  const target = context.assetPathById.get(assetId);
  const asset = context.assetById.get(assetId);
  if (!target || !asset) {
    context.warnings.add(`Page ${context.page.id} references missing asset ${assetId}.`);
    return `${escapeMarkdownText(label || 'Missing asset')} _(missing asset: ${assetId})_`;
  }
  const href = relativeLink(context.pagePathById.get(context.page.id)!, target);
  return image
    ? `![${escapeMarkdownText(label || asset.filename)}](${href})`
    : `[${escapeMarkdownText(label || asset.filename)}](${href})`;
}

function rewriteHref(href: string, label: string, context: MarkdownContext): string {
  const pageMatch = /^\/?page\/([0-9a-f-]+)\/?$/i.exec(href);
  if (pageMatch) {
    return pageLink(pageMatch[1], label, context);
  }
  const assetMatch = /^\/?api\/assets\/([0-9a-f]+)\/?$/i.exec(href);
  if (assetMatch) {
    return assetLink(assetMatch[1], label, context, false);
  }
  return `[${escapeMarkdownText(label || href)}](${href})`;
}

function inlineMarkdown(value: unknown, context: MarkdownContext): string {
  if (typeof value === 'string') {
    return escapeMarkdownText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => inlineMarkdown(item, context)).join('');
  }
  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'link' && typeof record.href === 'string') {
    const label = inlineMarkdown(record.content, context) || String(record.href);
    return rewriteHref(record.href, label.replace(/\\([\\`*_[\]<>])/g, '$1'), context);
  }
  if (type === 'pageLink') {
    const props = (record.props ?? record) as Record<string, unknown>;
    return pageLink(String(props.pageId ?? ''), String(props.title ?? 'Page'), context);
  }

  const rawText = typeof record.text === 'string'
    ? escapeMarkdownText(record.text)
    : inlineMarkdown(record.content ?? record.children, context);
  const styles = record.styles && typeof record.styles === 'object'
    ? record.styles as Record<string, unknown>
    : {};
  let text = rawText;
  if (styles.code) text = `\`${text}\``;
  if (styles.bold) text = `**${text}**`;
  if (styles.italic) text = `_${text}_`;
  if (styles.strike) text = `~~${text}~~`;
  return text;
}

function blockMarkdown(block: unknown, context: MarkdownContext): string {
  if (!block || typeof block !== 'object') {
    return '';
  }
  const record = block as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : 'unknown';
  const props = record.props && typeof record.props === 'object'
    ? record.props as Record<string, unknown>
    : {};
  const text = inlineMarkdown(record.content ?? record.text, context).trim();
  let rendered: string;

  switch (type) {
    case 'paragraph':
      rendered = text;
      break;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(props.level ?? record.level ?? 1)));
      rendered = `${'#'.repeat(level)} ${text}`;
      break;
    }
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      rendered = `${'#'.repeat(Number(type.at(-1)))} ${text}`;
      break;
    case 'bulletListItem':
      rendered = `- ${text}`;
      break;
    case 'numberedListItem':
      rendered = `1. ${text}`;
      break;
    case 'checkListItem':
    case 'todo':
      rendered = `- [${props.checked ? 'x' : ' '}] ${text}`;
      break;
    case 'quote':
    case 'callout':
      rendered = text.split('\n').map((line) => `> ${line}`).join('\n');
      break;
    case 'codeBlock': {
      const language = typeof props.language === 'string' ? props.language : '';
      rendered = `\`\`\`${language}\n${text}\n\`\`\``;
      break;
    }
    case 'pageLink':
    case 'pageCard':
      rendered = pageLink(String(props.pageId ?? record.pageId ?? ''), String(props.title ?? record.title ?? 'Page'), context);
      break;
    case 'image':
    case 'file':
    case 'audio':
    case 'video': {
      const url = String(props.url ?? record.url ?? '');
      const label = String(props.caption ?? props.name ?? record.caption ?? type);
      const assetMatch = /^\/?api\/assets\/([0-9a-f]+)\/?$/i.exec(url);
      rendered = assetMatch
        ? assetLink(assetMatch[1], label, context, type === 'image')
        : (url ? (type === 'image' ? `![${escapeMarkdownText(label)}](${url})` : `[${escapeMarkdownText(label)}](${url})`) : `${label} _(missing URL)_`);
      if (!url) {
        context.warnings.add(`Page ${context.page.id} contains a ${type} block without a URL.`);
      }
      break;
    }
    default: {
      const fallback = text || inlineMarkdown(record.children, context);
      context.warnings.add(`Page ${context.page.id} contains unsupported block type "${type}"; readable text and source JSON were retained.`);
      rendered = `${fallback ? `${fallback}\n\n` : ''}<!-- Unsupported Arcane Codex block: ${type}\n${JSON.stringify(canonicalize(record), null, 2)}\n-->`;
      break;
    }
  }

  if (Array.isArray(record.children) && record.children.length > 0) {
    const children = record.children
      .map((child) => blockMarkdown(child, context))
      .filter(Boolean)
      .map((child) => child.split('\n').map((line) => `  ${line}`).join('\n'))
      .join('\n');
    return children ? `${rendered}\n${children}` : rendered;
  }
  return rendered;
}

function pageToMarkdown(page: PageRecord, context: MarkdownContext, dataDir?: string): string {
  let blocks: unknown[] = [];
  let invalidBody: string | null = null;
  try {
    const parsed = JSON.parse(page.contentJson) as unknown;
    if (Array.isArray(parsed)) {
      blocks = parsed;
    } else if (typeof parsed === 'string') {
      invalidBody = parsed;
      context.warnings.add(`Page ${page.id} stored a string instead of block JSON; it was exported as plain text.`);
    } else {
      invalidBody = JSON.stringify(canonicalize(parsed), null, 2);
      context.warnings.add(`Page ${page.id} has non-array content JSON; its source was retained.`);
    }
  } catch {
    invalidBody = page.contentJson;
    context.warnings.add(`Page ${page.id} has invalid content JSON; its raw content was retained.`);
  }

  const pagePath = context.pagePathById.get(page.id)!;
  const coverPath = page.coverAssetId ? context.assetPathById.get(page.coverAssetId) : null;
  if (page.coverAssetId && !coverPath) {
    context.warnings.add(`Page ${page.id} references missing cover asset ${page.coverAssetId}.`);
  }

  const frontmatter = [
    '---',
    `id: ${escapeYaml(page.id)}`,
    `title: ${escapeYaml(page.title || 'Untitled')}`,
    `parent_id: ${page.parentId ? escapeYaml(page.parentId) : 'null'}`,
    `icon: ${page.icon ? escapeYaml(page.icon) : 'null'}`,
    `cover: ${coverPath ? escapeYaml(relativeLink(pagePath, coverPath)) : 'null'}`,
    `revision: ${page.revision}`,
    `created_at: ${escapeYaml(new Date(page.createdAt).toISOString())}`,
    `updated_at: ${escapeYaml(new Date(page.updatedAt).toISOString())}`,
    '---',
  ];

  const body = invalidBody === null
    ? blocks.map((block) => blockMarkdown(block, context)).filter(Boolean).join('\n\n')
    : `${invalidBody}\n\n<!-- Original page content was not valid BlockNote block JSON. -->`;
  const backlinks = readBacklinks(page.id, dataDir)
    .sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id));
  const backlinkSection = backlinks.length
    ? `## Backlinks\n\n${backlinks.map((source) => `- ${pageLink(source.id, source.title || 'Untitled', context)}`).join('\n')}`
    : '';

  return `${frontmatter.join('\n')}\n\n${body || '_Empty page_'}${backlinkSection ? `\n\n${backlinkSection}` : ''}\n`;
}

function csvCell(value: unknown): string {
  const text = value == null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(canonicalize(value));
  return `"${text.replaceAll('"', '""')}"`;
}

function collectionToCsv(
  collection: CollectionRecord,
  items: CollectionItemRecord[],
  pagesById: Map<string, PageRecord>,
  warnings: Set<string>,
): string {
  const schema = parseSchema(collection, warnings);
  const parsedItems = items.map((item) => ({
    item,
    properties: parseObject(
      item.propertiesJson,
      `Collection ${collection.id} item ${item.pageId} has invalid properties JSON; empty properties were exported.`,
      warnings,
    ),
  }));
  const schemaIds = new Set(schema.properties.map((property) => property.id));
  const extraIds = [...new Set(parsedItems.flatMap(({ properties }) => Object.keys(properties)))]
    .filter((id) => !schemaIds.has(id))
    .sort();
  const columns = [
    ...schema.properties.map((property) => ({ id: property.id, label: property.name || property.id })),
    ...extraIds.map((id) => ({ id, label: id })),
  ];
  const header = ['page_id', 'page_title', 'sort_key', ...columns.map((column) => column.label)];
  const rows = parsedItems
    .sort((left, right) => left.item.sortKey - right.item.sortKey || compareText(left.item.pageId, right.item.pageId))
    .map(({ item, properties }) => {
      const page = pagesById.get(item.pageId);
      if (!page) {
        warnings.add(`Collection ${collection.id} references missing or trashed page ${item.pageId}.`);
      }
      return [item.pageId, page?.title ?? '[missing or trashed page]', item.sortKey, ...columns.map((column) => properties[column.id])]
        .map(csvCell)
        .join(',');
    });
  return `${[header.map(csvCell).join(','), ...rows].join('\n')}\n`;
}

function collectionToMarkdown(
  collection: CollectionRecord,
  collectionPath: string,
  csvPath: string,
  items: CollectionItemRecord[],
  pagesById: Map<string, PageRecord>,
  pagePathById: Map<string, string>,
  warnings: Set<string>,
): string {
  const rows = items
    .slice()
    .sort((left, right) => left.sortKey - right.sortKey || compareText(left.pageId, right.pageId))
    .map((item) => {
      const page = pagesById.get(item.pageId);
      const target = pagePathById.get(item.pageId);
      if (!page || !target) {
        warnings.add(`Collection ${collection.id} references missing or trashed page ${item.pageId}.`);
        return `- Missing or trashed page (${item.pageId})`;
      }
      return `- [${escapeMarkdownText(page.title || 'Untitled')}](${relativeLink(collectionPath, target)})`;
    });

  return [
    `# ${escapeMarkdownText(collection.name)}`,
    '',
    `[Structured data (CSV)](${relativeLink(collectionPath, csvPath)})`,
    '',
    rows.length ? rows.join('\n') : '_No entries_',
    '',
  ].join('\n');
}

function exportReadme(manifest: ExportManifest): string {
  return `# Arcane Codex export\n\nThis deterministic snapshot contains active pages as Markdown, workspace assets, collection indexes and rows as Markdown/CSV, and a machine-readable manifest.\n\n- Page links are relative paths inside \`pages/\`.\n- Asset links are relative paths into \`assets/\`.\n- Collection indexes link to their page entries and companion CSV files.\n- Missing references and unsupported block fallbacks are listed in \`manifest.json\`.\n- Deleted pages and revision history are not included.\n\nSnapshot: ${manifest.snapshotAt}\nWarnings: ${manifest.warnings.length}\n`;
}

export function buildWorkspaceExport(dataDir?: string): WorkspaceExport {
  const warnings = new Set<string>();
  const pages = listPages(dataDir).sort((left, right) => compareText(left.id, right.id));
  const assets = listAssets(dataDir).sort((left, right) => compareText(left.id, right.id));
  const collections = listCollections(dataDir).sort((left, right) => compareText(left.id, right.id));
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const pagePathById = new Map(pages.map((page) => [page.id, `pages/${slug(page.title, 'untitled')}--${page.id}.md`]));
  const plannedAssetPathById = new Map(assets.map((asset) => [asset.id, `assets/${asset.id}--${safeFilename(asset.filename)}`]));
  const assetPathById = new Map(plannedAssetPathById);
  const entries: ExportEntry[] = [];

  for (const asset of assets) {
    const source = getAssetPathFromId(asset.id, dataDir);
    if (!source || !existsSync(source)) {
      assetPathById.delete(asset.id);
      warnings.add(`Asset ${asset.id} (${asset.filename}) is registered but missing on disk.`);
    }
  }

  for (const page of pages) {
    entries.push({
      path: pagePathById.get(page.id)!,
      data: pageToMarkdown(page, { page, pagePathById, assetPathById, assetById, warnings }, dataDir),
    });
  }

  const assetManifest = assets.map((asset) => {
    const source = getAssetPathFromId(asset.id, dataDir);
    const exported = Boolean(source && existsSync(source));
    if (exported) {
      entries.push({ path: plannedAssetPathById.get(asset.id)!, data: readFileSync(source) });
    }
    return {
      id: asset.id,
      path: plannedAssetPathById.get(asset.id)!,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      size: asset.size,
      exported,
    };
  });

  const collectionManifest = collections.map((collection) => {
    const basename = `${slug(collection.name, 'collection')}--${collection.id}`;
    const collectionPath = `collections/${basename}.csv`;
    const indexPath = `collections/${basename}.md`;
    const items = listCollectionItems(collection.id, dataDir);
    entries.push({
      path: collectionPath,
      data: collectionToCsv(collection, items, pagesById, warnings),
    });
    entries.push({
      path: indexPath,
      data: collectionToMarkdown(collection, indexPath, collectionPath, items, pagesById, pagePathById, warnings),
    });
    return { id: collection.id, path: collectionPath, indexPath, name: collection.name, itemCount: items.length };
  });

  const timestamps = [
    ...pages.flatMap((page) => [page.createdAt, page.updatedAt]),
    ...assets.map((asset) => asset.createdAt),
    ...collections.flatMap((collection) => [collection.createdAt, collection.updatedAt]),
  ];
  const snapshotAt = new Date(timestamps.length ? Math.max(...timestamps) : ZIP_ENTRY_DATE.getTime()).toISOString();
  const settings = getSettings(dataDir);
  const manifest: ExportManifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    snapshotAt,
    workspace: { name: settings.workspaceName, schemaVersion: settings.schemaVersion },
    pages: pages.map((page) => ({
      id: page.id,
      path: pagePathById.get(page.id)!,
      title: page.title,
      parentId: page.parentId,
      revision: page.revision,
      updatedAt: page.updatedAt,
    })),
    assets: assetManifest,
    collections: collectionManifest,
    warnings: [...warnings].sort(),
  };

  entries.push({ path: 'README.md', data: exportReadme(manifest) });
  entries.push({ path: 'manifest.json', data: `${JSON.stringify(canonicalize(manifest), null, 2)}\n` });
  entries.sort((left, right) => compareText(left.path, right.path));

  return {
    entries,
    manifest,
    filename: `arcane-codex-export-${snapshotAt.slice(0, 10)}.zip`,
  };
}

export async function exportWorkspaceZip(dataDir?: string): Promise<{ buffer: Buffer; manifest: ExportManifest; filename: string }> {
  const snapshot = buildWorkspaceExport(dataDir);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];

  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const entry of snapshot.entries) {
    archive.append(entry.data, {
      name: entry.path,
      date: ZIP_ENTRY_DATE,
      mode: 0o100644,
    });
  }
  await archive.finalize();

  return {
    buffer: await completed,
    manifest: snapshot.manifest,
    filename: snapshot.filename,
  };
}
