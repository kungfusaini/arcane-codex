"use client";

import Image from 'next/image';
import Link from 'next/link';
import { PageIcon } from '@/components/PageIcon';
import type { PageKind } from '@/lib/data/types';

export type PagePreviewData = {
  id: string;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
  coverAssetId: string | null;
  coverFocalX?: number;
  coverFocalY?: number;
  coverScale?: number;
  kind: PageKind;
  summary: string;
  publishedAt?: number | null;
};

const KIND_LABELS: Record<PageKind, string> = {
  page: 'Page',
  note: 'Note',
  article: 'Article',
  project: 'Project',
  fiction: 'Fiction',
};

export function PagePreview({ page, href, featured = false }: { page: PagePreviewData; href: string; featured?: boolean }) {
  const focalX = page.coverFocalX ?? 50;
  const focalY = page.coverFocalY ?? 50;
  const scale = page.coverScale ?? 100;
  return (
    <article className={`page-preview discovery-card ${featured ? 'is-featured' : ''}`}>
      <Link href={href} className="page-preview-link discovery-card-link">
        <div className="page-preview-banner discovery-card-media">
          {page.coverAssetId ? (
            <Image
              src={`/api/assets/${page.coverAssetId}`}
              alt=""
              width={720}
              height={405}
              unoptimized
              style={{ objectPosition: `${focalX}% ${focalY}%`, transform: `scale(${scale / 100})` }}
            />
          ) : (
            <span className="page-preview-placeholder" aria-hidden="true"><PageIcon icon={page.icon} iconAssetId={page.iconAssetId} /></span>
          )}
        </div>
        <div className="page-preview-copy discovery-card-copy">
          <span className="page-preview-kind">{KIND_LABELS[page.kind]}</span>
          <h3><PageIcon icon={page.icon} iconAssetId={page.iconAssetId} /> {page.title || 'Untitled'}</h3>
          {page.summary ? <p>{page.summary}</p> : null}
          <span className="page-preview-action">Open <span aria-hidden="true">↗</span></span>
        </div>
      </Link>
    </article>
  );
}
