import { NextResponse } from 'next/server';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type CommonsPage = {
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function filenameFromTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 12), 1), 24);

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const commonsParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '320',
  });

  const response = await fetch(`${COMMONS_API}?${commonsParams.toString()}`, {
    headers: { 'user-agent': 'Arcane-Codex/0.1 image-search' },
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    return NextResponse.json({ error: `Wikimedia Commons returned ${response.status}.` }, { status: 502 });
  }

  const payload = await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(payload.query?.pages ?? {});
  const results = pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!page.title || !info?.url || !info.mime || !SUPPORTED_MIME_TYPES.has(info.mime)) {
      return [];
    }
    const meta = info.extmetadata ?? {};
    const title = filenameFromTitle(page.title);
    const creator = plainText(meta.Artist?.value || meta.Credit?.value || meta.Attribution?.value);
    const license = plainText(meta.LicenseShortName?.value || meta.UsageTerms?.value || meta.License?.value) || 'Wikimedia Commons';
    const description = plainText(meta.ImageDescription?.value || meta.ObjectName?.value);
    return [{
      id: page.title,
      title,
      description,
      creator,
      license,
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      imageUrl: info.url,
      thumbnailUrl: info.thumburl || info.url,
      mimeType: info.mime,
    }];
  });

  return NextResponse.json({ results });
}
