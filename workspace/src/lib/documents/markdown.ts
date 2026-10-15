export const ARCANE_MARKDOWN_FORMAT = 'arcane-markdown' as const;
export const ARCANE_MARKDOWN_VERSION = 1;

export type DocumentBlock = Record<string, unknown>;

const ASSET_API_RE = /^\/?api\/assets\/([0-9a-f]{64})\/?$/i;
const ASSET_URI_RE = /^arcane:\/\/asset\/(?:sha256:)?([0-9a-f]{64})$/i;
const EXTENSION_RE = /<!-- arcane:begin ([A-Za-z][\w-]*) -->\n[\s\S]*?\n```arcane-data\n([\s\S]*?)\n```\n<!-- arcane:end \1 -->/g;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'id' && key !== 'editorOpen')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function escapeText(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function escapeLinkLabel(value: string): string {
  return value.replace(/([\\\]])/g, '\\$1');
}

export function canonicalAssetHref(value: string): string {
  const match = ASSET_API_RE.exec(value) ?? ASSET_URI_RE.exec(value);
  return match ? `arcane://asset/sha256:${match[1].toLowerCase()}` : value;
}

export function assetIdFromHref(value: string): string | null {
  return (ASSET_API_RE.exec(value) ?? ASSET_URI_RE.exec(value))?.[1]?.toLowerCase() ?? null;
}

function inlineMarkdown(value: unknown): string {
  if (typeof value === 'string') return escapeText(value);
  if (Array.isArray(value)) return value.map(inlineMarkdown).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (node.type === 'link' && typeof node.href === 'string') {
    return `[${escapeLinkLabel(inlineMarkdown(node.content) || node.href)}](${canonicalAssetHref(node.href)})`;
  }
  const raw = typeof node.text === 'string' ? escapeText(node.text) : inlineMarkdown(node.content ?? node.children);
  const styles = node.styles && typeof node.styles === 'object' ? node.styles as Record<string, unknown> : {};
  let text = raw;
  if (styles.code) text = `\`${text}\``;
  if (styles.bold) text = `**${text}**`;
  if (styles.italic) text = `_${text}_`;
  if (styles.strike) text = `~~${text}~~`;
  return text;
}

function galleryImages(props: Record<string, unknown>): Array<{ url: string; name?: string; caption?: string }> {
  const value = props.images;
  if (Array.isArray(value)) return value as Array<{ url: string; name?: string; caption?: string }>;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { url: string; name?: string; caption?: string } => Boolean(item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string')) : [];
  } catch {
    return [];
  }
}

function extensionBlock(type: string, block: DocumentBlock, fallback: string): string {
  const payload = JSON.stringify(canonicalize({ ...block, type, version: 1 }), null, 2);
  return [`<!-- arcane:begin ${type} -->`, fallback || `_${type}_`, '```arcane-data', payload, '```', `<!-- arcane:end ${type} -->`].join('\n');
}

function tableMarkdown(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const rows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || !rows.length) return '';
  const values = rows.map((row) => {
    const cells = row && typeof row === 'object' ? (row as { cells?: unknown }).cells : null;
    return Array.isArray(cells) ? cells.map((cell) => inlineMarkdown(cell).replaceAll('|', '\\|').replaceAll('\n', '<br>')) : [];
  });
  const width = Math.max(...values.map((row) => row.length), 1);
  const normalized = values.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function blockMarkdown(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const record = block as DocumentBlock;
  const type = typeof record.type === 'string' ? record.type : 'unknown';
  const props = record.props && typeof record.props === 'object' ? record.props as Record<string, unknown> : {};
  const text = inlineMarkdown(record.content ?? record.text).trim();
  let rendered = '';

  switch (type) {
    case 'paragraph': rendered = text; break;
    case 'heading': rendered = `${'#'.repeat(Math.min(6, Math.max(1, Number(props.level ?? 1))))} ${text}`; break;
    case 'bulletListItem': rendered = `- ${text}`; break;
    case 'numberedListItem': rendered = `1. ${text}`; break;
    case 'checkListItem': rendered = `- [${props.checked ? 'x' : ' '}] ${text}`; break;
    case 'quote': rendered = text.split('\n').map((line) => `> ${line}`).join('\n'); break;
    case 'codeBlock': rendered = `\`\`\`${typeof props.language === 'string' ? props.language : ''}\n${inlineMarkdown(record.content)}\n\`\`\``; break;
    case 'table': rendered = tableMarkdown(record.content); break;
    case 'pageLink': {
      const id = String(props.pageId ?? '');
      const title = String(props.title ?? 'Page').replace(/^\S+\s/, props.icon ? '' : '$&');
      const href = typeof props.url === 'string' && props.url ? props.url : `arcane://page/${id}`;
      rendered = `[${escapeLinkLabel(title || 'Page')}](${href})`;
      break;
    }
    case 'youtube': {
      const url = String(props.url ?? '');
      rendered = extensionBlock(type, record, url ? `[YouTube video](${url})` : '_YouTube video_');
      break;
    }
    case 'gallery': {
      const images = galleryImages(props);
      const fallback = images.map((image) => `![${escapeLinkLabel(image.caption || image.name || 'Image')}](${canonicalAssetHref(image.url)})`).join('\n\n');
      const normalized = { ...record, props: { ...props, images: images.map((image) => ({ ...image, url: canonicalAssetHref(image.url) })) } };
      rendered = extensionBlock(type, normalized, fallback || '_Empty gallery_');
      break;
    }
    case 'artworkShowcase': {
      const url = canonicalAssetHref(String(props.canvasUrl ?? ''));
      let frameUrls: unknown[] = [];
      try {
        const value = typeof props.frameUrls === 'string' ? JSON.parse(props.frameUrls) as unknown : props.frameUrls;
        if (Array.isArray(value)) frameUrls = value.map((frame) => {
          if (typeof frame === 'string') return canonicalAssetHref(frame);
          if (frame && typeof frame === 'object' && typeof (frame as { url?: unknown }).url === 'string') {
            return { ...(frame as Record<string, unknown>), url: canonicalAssetHref(String((frame as { url: string }).url)) };
          }
          return frame;
        });
      } catch { frameUrls = []; }
      const fallback = [url ? `![${escapeLinkLabel(String(props.canvasAlt ?? props.title ?? 'Artwork'))}](${url})` : '', props.prompt ? `> Prompt: ${String(props.prompt)}` : ''].filter(Boolean).join('\n\n');
      rendered = extensionBlock(type, { ...record, props: { ...props, canvasUrl: url, frameUrls } }, fallback);
      break;
    }
    case 'image': {
      const url = canonicalAssetHref(String(props.url ?? ''));
      rendered = `![${escapeLinkLabel(String(props.caption ?? props.name ?? 'Image'))}](${url})`;
      break;
    }
    case 'file':
    case 'audio':
    case 'video': {
      const url = canonicalAssetHref(String(props.url ?? ''));
      rendered = `[${escapeLinkLabel(String(props.caption ?? props.name ?? type))}](${url})`;
      break;
    }
    default: rendered = extensionBlock(type, record, text || `Unsupported block: ${type}`);
  }

  if (Array.isArray(record.children) && record.children.length) {
    const children = record.children.map(blockMarkdown).filter(Boolean).map((child) => child.split('\n').map((line) => `  ${line}`).join('\n')).join('\n');
    if (children) rendered = `${rendered}\n${children}`;
  }
  return rendered;
}

export function blocksToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) throw new Error('Document blocks must be an array.');
  return `${blocks.map(blockMarkdown).filter(Boolean).join('\n\n').trim()}${blocks.length ? '\n' : ''}`;
}

export type MarkdownSegment = { type: 'markdown'; source: string } | { type: 'extension'; extensionType: string; block: DocumentBlock };

export function normalizeMarkdownExtensions(source: string): string {
  return source.replace(EXTENSION_RE, (whole, type: string, payload: string) => {
    const block = JSON.parse(payload) as DocumentBlock;
    const props = block.props && typeof block.props === 'object' ? block.props as Record<string, unknown> : {};
    if (type === 'gallery' && typeof props.images === 'string') {
      try { props.images = JSON.parse(props.images); } catch { props.images = []; }
    }
    if (type === 'artworkShowcase' && typeof props.frameUrls === 'string') {
      try { props.frameUrls = JSON.parse(props.frameUrls); } catch { props.frameUrls = []; }
    }
    return whole.replace(payload, JSON.stringify(canonicalize({ ...block, props }), null, 2));
  });
}

export function splitMarkdownExtensions(source: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let offset = 0;
  for (const match of source.matchAll(EXTENSION_RE)) {
    const index = match.index ?? 0;
    const before = source.slice(offset, index).trim();
    if (before) segments.push({ type: 'markdown', source: before });
    const parsed = JSON.parse(match[2]) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error(`Invalid ${match[1]} extension payload.`);
    segments.push({ type: 'extension', extensionType: match[1], block: parsed as DocumentBlock });
    offset = index + match[0].length;
  }
  const after = source.slice(offset).trim();
  if (after) segments.push({ type: 'markdown', source: after });
  return segments;
}

export function validateMarkdown(source: string): string[] {
  const issues: string[] = [];
  const begins = [...source.matchAll(/<!-- arcane:begin ([A-Za-z][\w-]*) -->/g)].map((match) => match[1]);
  const ends = [...source.matchAll(/<!-- arcane:end ([A-Za-z][\w-]*) -->/g)].map((match) => match[1]);
  if (begins.length !== ends.length || begins.some((type, index) => ends[index] !== type)) {
    issues.push('Arcane extension boundaries are malformed.');
  }
  try {
    splitMarkdownExtensions(source);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Arcane extension payload is malformed.');
  }
  return issues;
}

export function pageIdsFromMarkdown(source: string): string[] {
  return [...new Set([...source.matchAll(/arcane:\/\/page\/([0-9a-f-]{36})/gi)].map((match) => match[1].toLowerCase()))];
}

export function assetIdsFromMarkdown(source: string): string[] {
  return [...new Set([...source.matchAll(/(?:arcane:\/\/asset\/(?:sha256:)?|\/?api\/assets\/)([0-9a-f]{64})/gi)].map((match) => match[1].toLowerCase()))];
}

export function firstImageFromMarkdown(source: string): string | null {
  const match = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(source);
  if (!match) return null;
  const id = assetIdFromHref(match[1]);
  return id ? `/api/assets/${id}` : match[1];
}

export function plainTextFromMarkdown(source: string): string {
  return source
    .replace(EXTENSION_RE, (_match, _type, payload) => {
      try {
        const value = JSON.parse(payload) as Record<string, unknown>;
        const props = value.props && typeof value.props === 'object' ? value.props as Record<string, unknown> : {};
        return [props.title, props.prompt, props.groupCaption].filter((item) => typeof item === 'string').join(' ');
      } catch { return ''; }
    })
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*>\d.\s]+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
