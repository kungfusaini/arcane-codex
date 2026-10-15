"use client";

import { useEffect, useState } from 'react';
import { PagePreview, type PagePreviewData } from '@/components/PagePreview';
import { buildWorkspacePagePathFromPages } from '@/lib/workspaceHome';
import type { PageUrlPage } from '@/lib/pageUrls';
import './home-discovery.css';

type DiscoveryCard = PagePreviewData & { updatedAt: number };

type DiscoverySection = { id: string; name: string; cards: DiscoveryCard[] };
type DiscoveryPayload = {
  projects: DiscoverySection | null;
  articles: DiscoveryCard[];
  shelves: DiscoverySection[];
};

type DiscoveryPage = PageUrlPage & { icon?: string | null; iconAssetId?: string | null };

function Card({ card, pages, pageRouteBasePath, featured = false }: { card: DiscoveryCard; pages: DiscoveryPage[]; pageRouteBasePath: string; featured?: boolean }) {
  return <PagePreview page={card} href={buildWorkspacePagePathFromPages(card.id, pages, pageRouteBasePath)} featured={featured} />;
}

export function HomeDiscovery({ pages, readOnly, pageRouteBasePath = '/' }: { pages: DiscoveryPage[]; readOnly: boolean; pageRouteBasePath?: string }) {
  const [payload, setPayload] = useState<DiscoveryPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/discovery${readOnly ? '?published=true' : ''}`)
      .then((response) => response.ok ? response.json() as Promise<DiscoveryPayload> : null)
      .then((next) => { if (!cancelled) setPayload(next); })
      .catch(() => { if (!cancelled) setPayload(null); });
    return () => { cancelled = true; };
  }, [readOnly]);

  if (!payload || (!payload.projects?.cards.length && !payload.articles.length && !payload.shelves.length)) return null;

  return (
    <section className="home-discovery" aria-label="Explore Arcane Codex">
      {payload.projects?.cards.length ? (
        <section className="discovery-section discovery-projects">
          <header><p className="eyebrow">Selected work</p><h2>Featured projects</h2><p>Things I have built and experiments worth exploring.</p></header>
          <div className="discovery-grid discovery-project-grid">
            {payload.projects.cards.slice(0, 4).map((card, index) => <Card key={card.id} card={card} pages={pages} pageRouteBasePath={pageRouteBasePath} featured={index === 0} />)}
          </div>
        </section>
      ) : null}

      {payload.articles.length ? (
        <section className="discovery-section">
          <header><p className="eyebrow">Writing</p><h2>Latest articles</h2><p>Finished essays and longer-form ideas, separate from working notes.</p></header>
          <div className="discovery-grid discovery-article-grid">
            {payload.articles.map((card) => <Card key={card.id} card={card} pages={pages} pageRouteBasePath={pageRouteBasePath} />)}
          </div>
        </section>
      ) : null}

      {payload.shelves.length ? (
        <section className="discovery-section discovery-shelves">
          <header><p className="eyebrow">Collections</p><h2>Recently added</h2><p>New entries from the library, cinema, jukebox, and other collections.</p></header>
          {payload.shelves.map((section) => (
            <section className="discovery-shelf" key={section.id}>
              <h3>{section.name}</h3>
              <div className="discovery-grid discovery-shelf-grid">
                {section.cards.map((card) => <Card key={card.id} card={card} pages={pages} pageRouteBasePath={pageRouteBasePath} />)}
              </div>
            </section>
          ))}
        </section>
      ) : null}
    </section>
  );
}
