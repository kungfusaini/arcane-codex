"use client";

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type PublishMediaItem = {
  type: 'image';
  src: string;
  alt?: string;
  caption?: string;
  label?: string;
} | {
  type: 'emoji';
  symbol: string;
  caption?: string;
  label?: string;
};

type PublishMediaModalProps = {
  items: PublishMediaItem[];
  activeIndex: number | null;
  onActiveIndexChange: (index: number | null) => void;
};

type PublishMediaTriggerProps = {
  item: PublishMediaItem;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
};

export function PublishMediaModal({ items, activeIndex, onActiveIndexChange }: PublishMediaModalProps) {
  const [mounted, setMounted] = useState(false);
  const item = activeIndex === null || !items.length ? null : items[Math.min(activeIndex, items.length - 1)];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!item) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onActiveIndexChange(null);
      }
    };
    document.addEventListener('keydown', closeWithEscape, true);
    return () => document.removeEventListener('keydown', closeWithEscape, true);
  }, [item, onActiveIndexChange]);

  if (!item || !mounted) return null;

  const displayedIndex = Math.min(activeIndex ?? 0, items.length - 1);
  const label = item.label || item.caption || (item.type === 'image' ? item.alt : item.symbol) || 'Published media';

  return createPortal(
    <div className="publish-media-modal" role="dialog" aria-modal="true" aria-label={label} onClick={() => onActiveIndexChange(null)}>
      <div className="publish-media-modal-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="publish-media-modal-close" onClick={() => onActiveIndexChange(null)} aria-label="Close media popup" autoFocus>×</button>
        <div className="publish-media-modal-stage">
          {item.type === 'image' ? <img src={item.src} alt={item.alt ?? ''} /> : null}
          {item.type === 'emoji' ? <span className="publish-media-modal-emoji" aria-hidden="true">{item.symbol}</span> : null}
        </div>
        {item.caption ? <p className="publish-media-modal-caption">{item.caption}</p> : null}
        {items.length > 1 ? (
          <div className="publish-media-modal-nav" aria-label="Media navigation">
            <button type="button" onClick={() => onActiveIndexChange((displayedIndex - 1 + items.length) % items.length)}>Previous</button>
            <span>{displayedIndex + 1} of {items.length}</span>
            <button type="button" onClick={() => onActiveIndexChange((displayedIndex + 1) % items.length)}>Next</button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function PublishMediaTrigger({ item, children, className = '', disabled = false }: PublishMediaTriggerProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  return (
    <>
      <button
        type="button"
        className={`publish-media-trigger ${className}`.trim()}
        onClick={() => setActiveIndex(0)}
        aria-label={`Open ${item.label || item.caption || (item.type === 'image' ? item.alt : item.symbol) || 'media'}`}
        disabled={disabled}
      >
        {children}
      </button>
      <PublishMediaModal items={[item]} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />
    </>
  );
}
