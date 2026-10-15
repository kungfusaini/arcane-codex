import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getAssetPathFromId,
  getSettings,
  listAssets,
  listCollectionItems,
  isAssetPublished,
  listCollections,
  listPages,
  listPublishedCollections,
  listPublishedPages,
  readBacklinks,
} from './storage';
import type {
  AssetRecord,
  CollectionItemRecord,
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
    kind: import('./types').PageKind;
    summary: string;
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
    prompt: string | null;
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
  pages: PageRecord[];
  warnings: Set<string>;
  includeBacklinks: boolean;
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

function parseSchema(collection: CollectionRecord): CollectionSchema {
  return collection.schema;
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

function stripLocalExtensionUrls(source: string, context: MarkdownContext): string {
  const isLocalUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(value);
  let removed = 0;
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value
        .filter((item) => {
          const local = isLocalUrl(item) || Boolean(item && typeof item === 'object' && isLocalUrl((item as { url?: unknown }).url));
          if (local) removed += 1;
          return !local;
        })
        .map(sanitize);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        if (isLocalUrl(child)) {
          removed += 1;
          return [key, ''];
        }
        return [key, sanitize(child)];
      }));
    }
    return value;
  };

  const rewritten = source.replace(/(```arcane-data\n)([\s\S]*?)(\n```)/g, (whole, start: string, payload: string, end: string) => {
    try {
      return `${start}${JSON.stringify(sanitize(JSON.parse(payload)), null, 2)}${end}`;
    } catch {
      return whole;
    }
  });
  if (removed) {
    context.warnings.add(`Page ${context.page.id} omitted ${removed} non-portable local extension URL(s).`);
  }
  return rewritten;
}

function rewriteCanonicalBody(source: string, context: MarkdownContext): string {
  for (const match of source.matchAll(/<!-- arcane:begin ([A-Za-z][\w-]*) -->/g)) {
    if (!['gallery', 'youtube', 'artworkShowcase'].includes(match[1])) {
      context.warnings.add(`Page ${context.page.id} contains unsupported block type "${match[1]}"; its readable fallback and extension data were retained.`);
    }
  }
  return stripLocalExtensionUrls(source, context)
    .replace(/arcane:\/\/page\/([0-9a-f-]{36})/gi, (_match, pageId: string) => {
      const target = context.pagePathById.get(pageId);
      if (!target) {
        context.warnings.add(`Page ${context.page.id} links to missing or trashed page ${pageId}.`);
        return `arcane://page/${pageId}`;
      }
      return relativeLink(context.pagePathById.get(context.page.id)!, target);
    })
    .replace(/arcane:\/\/asset\/(?:sha256:)?([0-9a-f]{64})/gi, (_match, assetId: string) => {
      const target = context.assetPathById.get(assetId);
      if (!target) {
        context.warnings.add(`Page ${context.page.id} references missing asset ${assetId}.`);
        return `arcane://asset/sha256:${assetId}`;
      }
      return relativeLink(context.pagePathById.get(context.page.id)!, target);
    });
}

function pageToMarkdown(page: PageRecord, context: MarkdownContext, dataDir?: string): string {
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
    `cover_focal_x: ${page.coverFocalX}`,
    `cover_focal_y: ${page.coverFocalY}`,
    `cover_scale: ${page.coverScale}`,
    `kind: ${escapeYaml(page.kind)}`,
    `summary: ${escapeYaml(page.summary)}`,
    `tags: ${JSON.stringify(page.tags)}`,
    `revision: ${page.revision}`,
    `created_at: ${escapeYaml(new Date(page.createdAt).toISOString())}`,
    `updated_at: ${escapeYaml(new Date(page.updatedAt).toISOString())}`,
    '---',
  ];

  const body = rewriteCanonicalBody(page.bodyMarkdown.trim(), context);
  const backlinks = context.includeBacklinks
    ? readBacklinks(page.id, dataDir).sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id))
    : [];
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
  const schema = parseSchema(collection);
  const parsedItems = items.map((item) => ({ item, properties: item.properties }));
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

export function buildWorkspaceExport(dataDir?: string, mode: 'workspace' | 'published' = 'workspace'): WorkspaceExport {
  const warnings = new Set<string>();
  const published = mode === 'published';
  const pages = (published ? listPublishedPages(true, dataDir) : listPages(dataDir)).sort((left, right) => compareText(left.id, right.id));
  const assets = listAssets(dataDir).filter((asset) => !published || isAssetPublished(asset.id, dataDir)).sort((left, right) => compareText(left.id, right.id));
  const collections = (published ? listPublishedCollections(dataDir) : listCollections(dataDir)).sort((left, right) => compareText(left.id, right.id));
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
      data: pageToMarkdown(page, { page, pagePathById, assetPathById, assetById, pages, warnings, includeBacklinks: !published }, dataDir),
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
      prompt: asset.prompt,
      exported,
    };
  });

  const collectionManifest = collections.map((collection) => {
    const basename = `${slug(collection.name, 'collection')}--${collection.id}`;
    const collectionPath = `collections/${basename}.csv`;
    const indexPath = `collections/${basename}.md`;
    const items = listCollectionItems(collection.id, dataDir).filter((item) => !published || pagesById.has(item.pageId));
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
      kind: page.kind,
      summary: page.summary,
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
    filename: `arcane-codex-${published ? 'published-site' : 'workspace-backup'}-${snapshotAt.slice(0, 10)}.zip`,
  };
}

export async function exportWorkspaceZip(dataDir?: string, mode: 'workspace' | 'published' = 'workspace'): Promise<{ buffer: Buffer; manifest: ExportManifest; filename: string }> {
  const snapshot = buildWorkspaceExport(dataDir, mode);
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
