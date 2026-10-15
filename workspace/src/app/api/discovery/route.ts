import { NextRequest, NextResponse } from 'next/server';
import { getCollectionDetailPayload } from '@/lib/data/collectionPayload';
import { listCollections, listPages, listPublishedCollections, listPublishedPages } from '@/lib/data/storage';
import { isPublishedAppSurface } from '@/lib/surface';

type DiscoveryCard = {
  id: string;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
  coverAssetId: string | null;
  coverFocalX: number;
  coverFocalY: number;
  coverScale: number;
  kind: import('@/lib/data/types').PageKind;
  summary: string;
  updatedAt: number;
};

export async function GET(request: NextRequest) {
  const published = isPublishedAppSurface() || new URL(request.url).searchParams.get('published') === 'true';
  const pages = published ? listPublishedPages(false) : listPages();
  const collections = published ? listPublishedCollections() : listCollections();
  const pageById = new Map(pages.map((page) => [page.id, page]));

  const articles: DiscoveryCard[] = pages
    .filter((page) => page.kind === 'article' || page.kind === 'fiction')
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 6)
    .map((page) => ({
      id: page.id,
      title: page.title,
      icon: page.icon,
      iconAssetId: page.iconAssetId,
      coverAssetId: page.coverAssetId,
      coverFocalX: page.coverFocalX,
      coverFocalY: page.coverFocalY,
      coverScale: page.coverScale,
      kind: page.kind,
      summary: page.summary,
      updatedAt: page.updatedAt,
    }));

  const sections = collections.map((collection) => {
    const payload = getCollectionDetailPayload(collection.id, { published });
    const cards = (payload?.items ?? [])
      .filter((item) => pageById.has(item.pageId))
      .sort((left, right) => right.page.updatedAt - left.page.updatedAt)
      .map((item): DiscoveryCard => {
        const summaryValue = item.properties.summary ?? item.properties.description ?? '';
        return {
          id: item.pageId,
          title: item.page.title,
          icon: item.page.icon,
          iconAssetId: item.page.iconAssetId,
          coverAssetId: item.page.coverAssetId,
          coverFocalX: item.page.coverFocalX,
          coverFocalY: item.page.coverFocalY,
          coverScale: item.page.coverScale,
          kind: item.page.kind,
          summary: item.page.summary || (typeof summaryValue === 'string' ? summaryValue : ''),
          updatedAt: item.page.updatedAt,
        };
      });
    return { id: collection.id, name: collection.name, cards };
  });

  const projects = sections.find((section) => section.name.trim().toLowerCase() === 'projects') ?? null;
  const shelves = sections.filter((section) => section !== projects && section.cards.length > 0)
    .map((section) => ({ ...section, cards: section.cards.slice(0, 4) }));

  return NextResponse.json({ projects, articles, shelves });
}
