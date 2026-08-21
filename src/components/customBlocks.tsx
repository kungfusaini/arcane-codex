/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BlockNoteEditor, BlockSpec, PartialBlock } from '@blocknote/core';
import { createReactBlockSpec, type DefaultReactSuggestionItem } from '@blocknote/react';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent } from 'react';
import { PageIcon } from '@/components/PageIcon';
import { buildPagePathFromPages } from '@/lib/pageUrls';
import { editGrabberImageToAsset, normalizeHttpUrl } from '@/lib/imageGrabber';
import { ImageGrabberPromptForm, ImageGrabberStrip, ImageGrabberUrlForm } from '@/components/ImageGrabberControls';
import { clearYouTubeDockSession, setYouTubeDockSession } from '@/components/youtubeDock';

export type ReferencedPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
};

export type CustomBlockContext = {
  editor: BlockNoteEditor<any>;
  referencedPages: Map<string, ReferencedPage>;
  insertBlock: (block: PartialBlock) => void;
  importAssetFromUrl: (url: string) => Promise<{ id: string; filename: string }>;
  uploadAssetRecord: (file: File) => Promise<{ id: string; filename: string }>;
  readOnly?: boolean;
  pageRouteBasePath?: string;
};

type CustomBlockSchemaContext = Pick<CustomBlockContext, 'referencedPages' | 'importAssetFromUrl' | 'uploadAssetRecord'> & Partial<Pick<CustomBlockContext, 'readOnly' | 'pageRouteBasePath'>>;

export type CustomBlockRegistration = {
  type: string;
  create: (context: CustomBlockSchemaContext) => BlockSpec<any, any, any>;
  slashMenu?: (context: CustomBlockContext) => DefaultReactSuggestionItem | DefaultReactSuggestionItem[];
};

function buildReactBlockSpec(config: any, implementation: any): () => BlockSpec<any, any, any> {
  return createReactBlockSpec(config, implementation) as () => BlockSpec<any, any, any>;
}

function getUrlTitle(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

export function getYouTubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (hostname === 'youtu.be') {
      id = url.pathname.slice(1).split('/')[0] ?? '';
    } else if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        id = url.pathname.split('/')[2] ?? '';
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

type GalleryImage = {
  url: string;
  name: string;
  caption?: string;
};

function readGalleryImages(value: unknown): GalleryImage[] {
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is GalleryImage => (
      typeof item === 'object'
      && item !== null
      && typeof (item as GalleryImage).url === 'string'
      && typeof (item as GalleryImage).name === 'string'
    ));
  } catch {
    return [];
  }
}

function readGalleryState(block: { id: string; props: Record<string, unknown> }) {
  const images = readGalleryImages(block.props.images);
  const mode = block.props.mode === 'single' ? 'single' : 'grid';
  const groupCaption = typeof block.props.groupCaption === 'string' ? block.props.groupCaption : '';
  const columns = Math.min(6, Math.max(1, Number(block.props.columns) || 3));
  const width = Math.min(100, Math.max(5, Number(block.props.width) || 100));
  return { images, mode, groupCaption, columns, width };
}

function YouTubeBlock({
  block,
  editor,
  readOnly,
}: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockNoteEditor<any>;
  readOnly: boolean;
}) {
  const [url, setUrl] = useState(typeof block.props.url === 'string' ? block.props.url : '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blockRef = useRef<HTMLElement | null>(null);
  const latestStateRef = useRef({ currentTime: 0, duration: 0, isPlaying: false, hasStarted: false, isDocked: false, videoId: '' as string | null, url: '' });
  const videoId = getYouTubeVideoId(String(block.props.url || ''));
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  };
  const sendCommand = (command: 'playVideo' | 'pauseVideo' | 'getCurrentTime' | 'getDuration' | 'seekTo', args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args }), '*');
  };
  useEffect(() => {
    setUrl(typeof block.props.url === 'string' ? block.props.url : '');
  }, [block.props.url]);
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasStarted(false);
    setIsDocked(false);
  }, [block.id, videoId]);
  useEffect(() => {
    const target = blockRef.current;
    if (!target || typeof IntersectionObserver === 'undefined' || !videoId) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsDocked(!(entry.isIntersecting && entry.intersectionRatio >= 0.2));
      },
      { threshold: [0, 0.2, 0.4, 1] },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [videoId]);
  useEffect(() => {
    const handleSeek = (event: Event) => {
      const seconds = (event as CustomEvent<{ seconds?: number }>).detail?.seconds;
      if (typeof seconds !== 'number' || seconds < 0) return;
      setCurrentTime(seconds);
      sendCommand('seekTo', [seconds, true]);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as {
          event?: string;
          info?: { currentTime?: number; duration?: number } | number;
        };
        if (payload.event === 'infoDelivery' && payload.info && typeof payload.info === 'object') {
          if (typeof payload.info.currentTime === 'number') setCurrentTime(payload.info.currentTime);
          if (typeof payload.info.duration === 'number' && payload.info.duration > 0) setDuration(payload.info.duration);
        }
        if (payload.event === 'onStateChange' && typeof payload.info === 'number') {
          setIsPlaying(payload.info === 1 || payload.info === 3);
          if (payload.info === 1 || payload.info === 3) setHasStarted(true);
        }
      } catch {
        // Ignore unrelated messages from embedded media.
      }
    };
    window.addEventListener('message', handleMessage);
    window.addEventListener('arcane-youtube-seek', handleSeek);
    const poll = window.setInterval(() => {
      sendCommand('getCurrentTime');
      sendCommand('getDuration');
    }, 500);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('arcane-youtube-seek', handleSeek);
      window.clearInterval(poll);
    };
  }, [videoId]);
  latestStateRef.current = { currentTime, duration, isPlaying, hasStarted, isDocked, videoId: videoId ?? '', url };
  useEffect(() => {
    if (!videoId || !hasStarted) return;
    const activeVideoId = videoId;
    setYouTubeDockSession({
      sourceBlockId: block.id,
      videoId: activeVideoId,
      url,
      title: 'Incubus — Drive',
      currentTime,
      duration,
      isPlaying,
      isVisible: true,
    });
  }, [block.id, currentTime, duration, hasStarted, isPlaying, url, videoId]);
  useEffect(() => () => {
    const latest = latestStateRef.current;
    if (latest.hasStarted || latest.isPlaying) {
      setYouTubeDockSession({
        sourceBlockId: block.id,
        videoId: latest.videoId || '',
        url: latest.url,
        title: 'Incubus — Drive',
        currentTime: latest.currentTime,
        duration: latest.duration,
        isPlaying: latest.isPlaying,
        isVisible: true,
      });
    } else {
      clearYouTubeDockSession(block.id);
    }
  }, [block.id]);
  const togglePlayback = () => {
    const nextPlaying = !isPlaying;
    sendCommand(nextPlaying ? 'playVideo' : 'pauseVideo');
    setIsPlaying(nextPlaying);
    if (nextPlaying) setHasStarted(true);
  };
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const updateUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = url.trim();
    if (!getYouTubeVideoId(normalized)) return;
    editor.updateBlock(block.id, { props: { url: normalized } } as never);
  };

  return (
    <section
      ref={blockRef}
      className={`youtube-block youtube-compact ${videoId ? 'youtube-has-video' : 'youtube-needs-url'} ${isDocked && hasStarted ? 'youtube-block--docked' : ''}`}
      contentEditable={false}
      aria-label="YouTube video"
    >
      {videoId ? <div className="youtube-custom-player youtube-inline-player">
        <iframe
          ref={iframeRef}
          onLoad={() => {
            const target = iframeRef.current?.contentWindow;
            target?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
            target?.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), '*');
            sendCommand('getDuration');
          }}
          className="youtube-transport"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&enablejsapi=1&origin=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`}
          title="YouTube audio transport"
          tabIndex={-1}
          aria-hidden="true"
          allow="autoplay; encrypted-media"
        />
        <button type="button" className="youtube-play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause audio' : 'Play audio'}>
          <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
        </button>
        <div className="youtube-track-copy"><strong>Incubus — Drive</strong><span>Audio from YouTube</span></div>
        <span className="youtube-playing-state visually-hidden" aria-live="polite">{isPlaying ? 'Playing' : 'Ready'}</span>
        <span className="youtube-time" aria-label={`Current time ${formatTime(currentTime)} of ${duration ? formatTime(duration) : 'unknown'}`}>{formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}</span>
        <span className="youtube-actions">
          <a className="youtube-action-button" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube" title="Open on YouTube">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.8V8.2l6.4 3.8-6.4 3.8Z" /></svg>
          </a>
          <button type="button" className="youtube-action-button youtube-copy-button" onClick={() => void copyUrl()} aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Link copied' : 'Copy link'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 12.9 12 16.2a4.2 4.2 0 0 0 5.9 0l2.3-2.3a4.2 4.2 0 0 0-5.9-5.9l-1.1 1.1M15.3 11.1 12 7.8a4.2 4.2 0 0 0-5.9 0l-2.3 2.3a4.2 4.2 0 0 0 5.9 5.9l1.1-1.1" /></svg>
          </button>
        </span>
        <input
          className="youtube-seeker"
          type="range"
          min="0"
          max={duration || 240}
          step="1"
          value={Math.min(currentTime, duration || 1)}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            setCurrentTime(nextTime);
            sendCommand('seekTo', [nextTime, true]);
          }}
          aria-label="Seek through audio"
        />
      </div> : null}
      {readOnly ? null : (
        <>
          <form className="youtube-url-form" onSubmit={updateUrl}>
            <label>YouTube URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
            <button type="submit" disabled={!getYouTubeVideoId(url)}>Embed video</button>
          </form>
          <p className="youtube-help">Use a youtube.com, youtu.be, or YouTube Shorts link.</p>
        </>
      )}
    </section>
  );
}

function GalleryBlock({
  block,
  editor,
  importAssetFromUrl,
  readOnly,
}: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockNoteEditor<any>;
  importAssetFromUrl: CustomBlockContext['importAssetFromUrl'];
  readOnly: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; parentWidth: number; pointerId: number } | null>(null);
  const { images, mode, groupCaption, columns, width } = readGalleryState(block);
  const editorOpen = !readOnly && block.props.editorOpen === true;
  const gridColumns = mode === 'grid' ? Math.min(images.length || 1, columns) : columns;
  const renderedWidth = draftWidth ?? width;
  const safeActiveIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeActiveIndex];

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props: { ...block.props, ...props } } as never);
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const parent = event.currentTarget.parentElement?.parentElement;
    if (!parent) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { startX: event.clientX, startWidth: width, parentWidth: parent.parentElement?.getBoundingClientRect().width || parent.getBoundingClientRect().width, pointerId: event.pointerId };
  };

  const resize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const nextWidth = Math.min(100, Math.max(5, current.startWidth + ((event.clientX - current.startX) / Math.max(current.parentWidth, 1)) * 100));
    setDraftWidth(nextWidth);
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    const nextWidth = draftWidth ?? width;
    updateBlock({ images: JSON.stringify(images), mode, columns, groupCaption, width: Math.round(nextWidth) });
    setDraftWidth(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const move = (direction: -1 | 1) => {
    if (!images.length) return;
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (touchStartX.current === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) >= 40) move(delta < 0 ? 1 : -1);
  };

  if (editorOpen) {
    return (
      <GalleryWidgetEditorShell
        blockId={block.id}
        editor={editor}
        importAssetFromUrl={importAssetFromUrl}
        onClose={() => updateBlock({ editorOpen: false })}
      />
    );
  }

  return (
    <section className={`gallery-block gallery-mode-${mode}`} contentEditable={false} tabIndex={0} aria-label="Image gallery" style={{ width: `${renderedWidth}%` }} onClickCapture={readOnly ? undefined : (event) => {
      if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
      updateBlock({ editorOpen: true });
    }}>
      {mode === 'single' && activeImage ? (
        <>
          <div className={`gallery-single ${images.length > 1 ? 'gallery-single-navigable' : 'gallery-single-static'}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-previous" onClick={() => move(-1)} aria-label="Previous image">‹</button> : null}
            <figure className="gallery-item">
              <img src={activeImage.url} alt={activeImage.name} />
              {activeImage.caption ? <figcaption>{activeImage.caption}</figcaption> : null}
            </figure>
            {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-next" onClick={() => move(1)} aria-label="Next image">›</button> : null}
          </div>
          {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
        </>
      ) : images.length ? (
        <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
          {images.map((image, index) => (
            <figure className="gallery-item" key={`${image.url}-${index}`}>
              <img src={image.url} alt={image.name} />
              {image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : <p className="gallery-empty">No images yet. Open settings to add one.</p>}
      {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
      {readOnly ? null : <button
        type="button"
        className="gallery-resize-handle"
        aria-label="Resize gallery"
        title="Resize gallery"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />}
    </section>
  );
}

export function GalleryWidgetEditorShell({
  blockId,
  editor,
  importAssetFromUrl,
  onClose,
}: {
  blockId: string;
  editor: BlockNoteEditor<any>;
  importAssetFromUrl: CustomBlockContext['importAssetFromUrl'];
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const addUrlInputRef = useRef<HTMLInputElement>(null);
  const block = editor.getBlock(blockId) as { id: string; props: Record<string, unknown> } | undefined;
  const [url, setUrl] = useState('');
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [error, setError] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imagePromptBusy, setImagePromptBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const state = block ? readGalleryState(block) : { images: [], mode: 'grid' as const, groupCaption: '', columns: 3, width: 100 };
  const { images, mode, groupCaption, columns, width } = state;
  const gridColumns = mode === 'grid' ? Math.min(images.length || 1, columns) : columns;
  const renderedWidth = width;
  const safeActiveIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeActiveIndex];

  useEffect(() => {
    if (showAddUrl) {
      addUrlInputRef.current?.focus();
    }
  }, [showAddUrl]);

  useEffect(() => {
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', dismissWithEscape, true);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      document.removeEventListener('keydown', dismissWithEscape, true);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [onClose]);

  if (!block) {
    return null;
  }

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props: { ...block.props, ...props } } as never);
  };

  const updateImages = (nextImages: GalleryImage[]) => updateBlock({ images: JSON.stringify(nextImages), mode, columns, groupCaption, width });

  const duplicateActiveImage = () => {
    if (!activeImage) return;
    const nextImages = [...images.slice(0, safeActiveIndex + 1), { ...activeImage }, ...images.slice(safeActiveIndex + 1)];
    updateImages(nextImages);
    setActiveIndex(safeActiveIndex + 1);
  };

  const moveSelectedImage = (direction: -1 | 1) => {
    const nextIndex = safeActiveIndex + direction;
    if (!activeImage || nextIndex < 0 || nextIndex >= images.length) return;
    const nextImages = [...images];
    [nextImages[safeActiveIndex], nextImages[nextIndex]] = [nextImages[nextIndex], nextImages[safeActiveIndex]];
    updateImages(nextImages);
    setActiveIndex(nextIndex);
  };

  const applyImagePrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeImage || !imagePrompt.trim() || imagePromptBusy) return;
    setImagePromptBusy(true);
    try {
      const grabbed = await editGrabberImageToAsset(activeImage.url, imagePrompt);
      const nextImages = images.map((image, index) => index === safeActiveIndex ? { ...image, url: grabbed.url, name: grabbed.name } : image);
      updateImages(nextImages);
      setImagePrompt('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image edit failed');
    } finally {
      setImagePromptBusy(false);
    }
  };

  const addUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Paste an image URL first.');
      return;
    }
    try {
      const normalized = normalizeHttpUrl(trimmedUrl);
      if (!normalized) {
        throw new Error('Enter a valid HTTP(S) image URL.');
      }
      const asset = await importAssetFromUrl(normalized);
      updateImages([...images, { url: `/api/assets/${asset.id}`, name: asset.filename, caption: '' }]);
      setActiveIndex(images.length);
      setUrl('');
      setShowAddUrl(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image import failed');
    }
  };

  const removeImage = (index: number) => {
    updateImages(images.filter((_, imageIndex) => imageIndex !== index));
    setActiveIndex(Math.max(0, Math.min(safeActiveIndex, images.length - 2)));
  };

  const updateCaption = (index: number, caption: string) => {
    updateImages(images.map((image, imageIndex) => imageIndex === index ? { ...image, caption } : image));
  };

  const move = (direction: -1 | 1) => {
    if (!images.length) return;
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (touchStartX.current === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) >= 40) move(delta < 0 ? 1 : -1);
  };

  return (
    <section ref={rootRef} className="gallery-widget-shell" aria-label="Gallery settings">
      <header className="gallery-widget-shell-header">
        <div>
          <p className="gallery-widget-kicker">Widget settings</p>
          <h2>Gallery</h2>
        </div>
      </header>
      <div className="gallery-widget-shell-body">
        <section className="gallery-widget-preview" aria-label="Gallery preview">
          <div className={`gallery-block gallery-mode-${mode}`} contentEditable={false} tabIndex={0} aria-label="Image gallery preview" style={{ width: `${renderedWidth}%` }}>
            {mode === 'single' && activeImage ? (
              <>
                <div className={`gallery-single ${images.length > 1 ? 'gallery-single-navigable' : 'gallery-single-static'}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
                  {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-previous" onClick={() => move(-1)} aria-label="Previous image">‹</button> : null}
                  <figure className="gallery-item">
                    <img src={activeImage.url} alt={activeImage.name} />
                    {activeImage.caption ? <figcaption>{activeImage.caption}</figcaption> : null}
                    <button type="button" onClick={() => removeImage(safeActiveIndex)} aria-label={`Remove ${activeImage.name}`}>Remove</button>
                  </figure>
                  {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-next" onClick={() => move(1)} aria-label="Next image">›</button> : null}
                </div>
                {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
              </>
            ) : images.length ? (
              <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                {images.map((image, index) => (
                  <figure className="gallery-item" key={`${image.url}-${index}`}>
                    <img src={image.url} alt={image.name} />
                    {image.caption ? <figcaption>{image.caption}</figcaption> : null}
                    <button type="button" onClick={() => removeImage(index)} aria-label={`Remove ${image.name}`}>Remove</button>
                  </figure>
                ))}
              </div>
            ) : <p className="gallery-empty">No images yet. Add one by URL or upload.</p>}
            {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
          </div>
        </section>

        <aside className="gallery-widget-panel">
          <section className="gallery-widget-section gallery-widget-primary-section" aria-label="Selected image controls">
            <div className="gallery-widget-section-heading">
              <h3>Selected image</h3>
              <span>{activeImage ? `${safeActiveIndex + 1} of ${images.length}` : 'No image selected'}</span>
            </div>
            <ImageGrabberStrip
              images={images}
              activeIndex={safeActiveIndex}
              onSelect={setActiveIndex}
              onAdd={() => setShowAddUrl((current) => !current)}
            />
            {showAddUrl ? (
              <ImageGrabberUrlForm
                label="Paste image URL"
                value={url}
                submitLabel="Add image"
                className="gallery-widget-url-form gallery-widget-inline-form"
                fieldClassName="gallery-widget-field"
                submitClassName=""
                inputRef={addUrlInputRef}
                onChange={setUrl}
                onSubmit={addUrl}
                onCancel={() => { setShowAddUrl(false); setUrl(''); }}
              />
            ) : null}
            <label className="gallery-widget-field">Caption
              <input type="text" value={activeImage?.caption ?? ''} onChange={(event) => updateCaption(safeActiveIndex, event.target.value)} placeholder="Add a caption" disabled={!activeImage} />
            </label>
            <div className="gallery-widget-actions">
              <button type="button" onClick={() => moveSelectedImage(-1)} disabled={!activeImage || safeActiveIndex === 0}>Move left</button>
              <button type="button" onClick={() => moveSelectedImage(1)} disabled={!activeImage || safeActiveIndex >= images.length - 1}>Move right</button>
              <button type="button" onClick={duplicateActiveImage} disabled={!activeImage}>Duplicate</button>
              <button type="button" onClick={() => removeImage(safeActiveIndex)} disabled={!activeImage}>Remove</button>
            </div>
          </section>

          <section className="gallery-widget-section" aria-label="AI edit current image">
            <ImageGrabberPromptForm
              label="Prompt"
              value={imagePrompt}
              placeholder="Make her look sad"
              submitLabel="Apply edit"
              busy={imagePromptBusy}
              disabled={!activeImage}
              className="gallery-widget-ai-form"
              fieldClassName="gallery-widget-field"
              submitClassName=""
              heading={(
                <div className="gallery-widget-section-heading">
                  <h3>AI edit</h3>
                  <span>Current image only</span>
                </div>
              )}
              onChange={setImagePrompt}
              onSubmit={applyImagePrompt}
            />
          </section>

          <section className="gallery-widget-section" aria-label="Gallery appearance">
            <div className="gallery-widget-section-heading"><h3>Appearance</h3></div>
            <label className="gallery-widget-field">Display
              <select value={mode} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode: event.target.value, columns, groupCaption, width })}>
                <option value="grid">Grid</option>
                <option value="single">Single image</option>
              </select>
            </label>
            <label className="gallery-widget-field">Width
              <input type="range" min={5} max={100} step={1} value={renderedWidth} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, columns, groupCaption, width: Number(event.currentTarget.value) })} />
            </label>
            <label className="gallery-widget-field">Columns
              <input type="range" min={1} max={6} step={1} value={columns} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, columns: Number(event.currentTarget.value), groupCaption, width })} disabled={mode !== 'grid'} />
              <span>{gridColumns} per row</span>
            </label>
            <label className="gallery-widget-field">Group caption
              <input type="text" value={groupCaption} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, columns, groupCaption: event.target.value, width })} placeholder="Add a group caption" />
            </label>
          </section>
          {error ? <p className="gallery-error" role="alert">{error}</p> : null}
        </aside>
      </div>
    </section>
  );
}

const pageLinkBlock: CustomBlockRegistration = {
  type: 'pageLink',
  create: ({ referencedPages, pageRouteBasePath }) => {
    const routeBasePath = pageRouteBasePath ?? '/';
    return buildReactBlockSpec(
    {
      type: 'pageLink',
      propSchema: {
        pageId: { default: '' },
        title: { default: '' },
        icon: { default: '' },
        url: { default: '' },
      },
      content: 'none',
    },
    {
      render: (props: any) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const fallbackReference = { id: pageId, parentId: null, sortKey: 0, title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null, iconAssetId: null };
        const reference = pageId
          ? referencedPages.get(pageId) ?? fallbackReference
          : { id: '', parentId: null, sortKey: 0, title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null, iconAssetId: null };
        const label = `${reference.icon ? `${reference.icon} ` : ''}${reference.title || String(propsByType.title || 'Page')}`;
        const href = externalUrl || (pageId ? buildPagePathFromPages(pageId, referencedPages.size ? Array.from(referencedPages.values()) : [reference], routeBasePath) : '#');

        const openPage = (event: MouseEvent<HTMLAnchorElement>) => {
          if (!pageId) {
            return;
          }
          event.preventDefault();
          window.location.href = href;
        };

        return (
          <a
            className="page-link-block"
            href={href}
            aria-label={`Open ${label}`}
            onClick={openPage}
            target={externalUrl ? '_blank' : undefined}
            rel={externalUrl ? 'noreferrer' : undefined}
            contentEditable={false}
            draggable={false}
          >
            <PageIcon className="page-link-icon" icon={reference.icon} iconAssetId={reference.iconAssetId} />
            <span className="page-link-title">{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
      toExternalHTML: (props: any) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const fallbackReference = { id: pageId, parentId: null, sortKey: 0, title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null, iconAssetId: null };
        const reference = pageId
          ? referencedPages.get(pageId) ?? fallbackReference
          : { id: '', parentId: null, sortKey: 0, title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null, iconAssetId: null };
        return (
          <a href={externalUrl || (pageId ? buildPagePathFromPages(pageId, referencedPages.size ? Array.from(referencedPages.values()) : [reference], routeBasePath) : '#')} target={externalUrl ? '_blank' : undefined} rel={externalUrl ? 'noreferrer' : undefined}>
            <PageIcon icon={reference.icon} iconAssetId={reference.iconAssetId} />
            <span>{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
    },
  )();
  },
};

const youtubeBlock: CustomBlockRegistration = {
  type: 'youtube',
  create: ({ readOnly }) => buildReactBlockSpec(
    {
      type: 'youtube',
      propSchema: { url: { default: '' } },
      content: 'none',
    },
    {
      render: (props: any) => <YouTubeBlock block={props.block as unknown as { id: string; props: Record<string, unknown> }} editor={props.editor} readOnly={readOnly ?? false} />,
      toExternalHTML: (props: any) => {
        const videoId = getYouTubeVideoId(String((props.block.props as Record<string, unknown>).url || ''));
        return videoId ? <div className="youtube-embed"><iframe src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`} title="YouTube video" allowFullScreen /></div> : <p>Invalid YouTube URL</p>;
      },
    },
  )(),
  slashMenu: ({ insertBlock }) => ({
    title: 'YouTube video',
    subtext: 'Embed a YouTube video from its URL',
    group: 'Media',
    onItemClick: () => insertBlock({ type: 'youtube', props: { url: '' } } as unknown as PartialBlock),
  }),
};

const galleryBlock: CustomBlockRegistration = {
  type: 'gallery',
  create: ({ importAssetFromUrl, readOnly }) => buildReactBlockSpec(
    {
      type: 'gallery',
      propSchema: {
        images: { default: '[]' },
        columns: { default: 3 },
        mode: { default: 'grid' },
        captionMode: { default: 'individual' },
        groupCaption: { default: '' },
        width: { default: 100 },
        editorOpen: { default: false },
      },
      content: 'none',
    },
    {
      render: (props: any) => (
        <GalleryBlock
          block={props.block as unknown as { id: string; props: Record<string, unknown> }}
          editor={props.editor}
          importAssetFromUrl={importAssetFromUrl}
          readOnly={readOnly ?? false}
        />
      ),
      toExternalHTML: (props: any) => {
        const images = readGalleryImages((props.block.props as Record<string, unknown>).images);
        return (
          <div>
            {images.map((image) => <img key={image.url} src={image.url} alt={image.name} />)}
          </div>
        );
      },
    },
  )(),
  slashMenu: ({ insertBlock }) => ({
    title: 'Gallery',
    subtext: 'Add one or more images by URL or upload',
    group: 'Media',
    onItemClick: () => insertBlock({ type: 'gallery', props: { images: '[]', columns: 3, mode: 'grid', captionMode: 'individual', groupCaption: '', width: 100 } } as unknown as PartialBlock),
  }),
};

/** Trusted, code-authored blocks. Add a registration here; slashMenu is opt-in. */
export const customBlockRegistry: CustomBlockRegistration[] = [pageLinkBlock, youtubeBlock, galleryBlock];

export function createCustomBlockSpecs(context: CustomBlockSchemaContext): Record<string, BlockSpec<any, any, any>> {
  return Object.fromEntries(customBlockRegistry.map((registration) => [registration.type, registration.create(context)]));
}

export function getCustomSlashMenuItems(context: CustomBlockContext, query: string): DefaultReactSuggestionItem[] {
  const normalized = query.trim().toLowerCase();
  return customBlockRegistry.flatMap((registration) => {
    if (!registration.slashMenu) {
      return [];
    }
    const registeredItems = registration.slashMenu(context);
    const items = Array.isArray(registeredItems) ? registeredItems : [registeredItems];
    return items.filter((item) => {
      const haystack = [item.title, item.subtext, ...(item.aliases ?? [])].filter(Boolean).join(' ').toLowerCase();
      return !normalized || haystack.includes(normalized);
    });
  });
}
