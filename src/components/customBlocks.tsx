/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BlockNoteEditor, BlockSpec, PartialBlock } from '@blocknote/core';
import {
  createReactBlockSpec,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent } from 'react';

export type ReferencedPage = {
  title: string;
  icon: string | null;
};

export type CustomBlockContext = {
  editor: BlockNoteEditor<any>;
  referencedPages: Map<string, ReferencedPage>;
  insertBlock: (block: PartialBlock) => void;
  importAssetFromUrl: (url: string) => Promise<{ id: string; filename: string }>;
  uploadAssetRecord: (file: File) => Promise<{ id: string; filename: string }>;
};

type CustomBlockSchemaContext = Pick<CustomBlockContext, 'referencedPages' | 'importAssetFromUrl' | 'uploadAssetRecord'>;

export type CustomBlockRegistration = {
  type: string;
  create: (context: CustomBlockSchemaContext) => BlockSpec<any, any, any>;
  slashMenu?: (context: CustomBlockContext) => DefaultReactSuggestionItem | DefaultReactSuggestionItem[];
};

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
  const columns = Math.min(4, Math.max(1, Number(block.props.columns) || 3));
  const width = Math.min(100, Math.max(5, Number(block.props.width) || 100));
  return { images, mode, groupCaption, columns, width };
}

function YouTubeBlock({
  block,
  editor,
}: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockNoteEditor<any>;
}) {
  const [url, setUrl] = useState(typeof block.props.url === 'string' ? block.props.url : '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
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
    const handleSeek = (event: Event) => {
      const seconds = (event as CustomEvent<{ seconds?: number }>).detail?.seconds;
      if (typeof seconds !== 'number' || seconds < 0) return;
      setCurrentTime(seconds);
      sendCommand('seekTo', [seconds, true]);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as { event?: string; info?: { currentTime?: number; duration?: number } };
        if (payload.event !== 'infoDelivery' || !payload.info) return;
        if (typeof payload.info.currentTime === 'number') setCurrentTime(payload.info.currentTime);
        if (typeof payload.info.duration === 'number' && payload.info.duration > 0) setDuration(payload.info.duration);
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
  const togglePlayback = () => {
    const nextPlaying = !isPlaying;
    sendCommand(nextPlaying ? 'playVideo' : 'pauseVideo');
    setIsPlaying(nextPlaying);
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
    <section className={`youtube-block youtube-compact ${videoId ? 'youtube-has-video' : 'youtube-needs-url'}`} contentEditable={false} aria-label="YouTube video">
      {videoId ? <div className="youtube-custom-player">
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
        <span className="youtube-playing-state" aria-live="polite">{isPlaying ? 'Playing' : 'Ready'}</span>
        <span className="youtube-time" aria-label={`Current time ${formatTime(currentTime)} of ${duration ? formatTime(duration) : 'unknown'}`}>{formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}</span>
        <span className="youtube-actions">
          <a className="youtube-action-button" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube" title="Open on YouTube">YouTube</a>
          <button type="button" className="youtube-action-button youtube-copy-button" onClick={() => void copyUrl()} aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Link copied' : 'Copy link'}>
            <span aria-hidden="true">🔗</span>
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
      <form className="youtube-url-form" onSubmit={updateUrl}>
        <label>YouTube URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
        <button type="submit" disabled={!getYouTubeVideoId(url)}>Embed video</button>
      </form>
      <p className="youtube-help">Use a youtube.com, youtu.be, or YouTube Shorts link.</p>
    </section>
  );
}

function GalleryBlock({
  block,
  editor,
  importAssetFromUrl,
  uploadAssetRecord,
}: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockNoteEditor<any>;
  importAssetFromUrl: CustomBlockContext['importAssetFromUrl'];
  uploadAssetRecord: CustomBlockContext['uploadAssetRecord'];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const [isEditingWidget, setIsEditingWidget] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; parentWidth: number; pointerId: number } | null>(null);
  const { images, mode, groupCaption, columns, width } = readGalleryState(block);
  const renderedWidth = draftWidth ?? width;
  const safeActiveIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeActiveIndex];

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props } as never);
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

  if (isEditingWidget) {
    return (
      <GalleryWidgetEditorShell
        blockId={block.id}
        editor={editor}
        importAssetFromUrl={importAssetFromUrl}
        uploadAssetRecord={uploadAssetRecord}
        onClose={() => setIsEditingWidget(false)}
      />
    );
  }

  return (
    <section className={`gallery-block gallery-mode-${mode}`} contentEditable={false} tabIndex={0} aria-label="Image gallery" style={{ width: `${renderedWidth}%` }}>
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
        <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {images.map((image, index) => (
            <figure className="gallery-item" key={`${image.url}-${index}`}>
              <img src={image.url} alt={image.name} />
              {image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : <p className="gallery-empty">No images yet. Open settings to add one.</p>}
      {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
      <button type="button" className="gallery-settings-trigger" onClick={() => setIsEditingWidget(true)}>Settings</button>
      <button
        type="button"
        className="gallery-resize-handle"
        aria-label="Resize gallery"
        title="Resize gallery"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
    </section>
  );
}

export function GalleryWidgetEditorShell({
  blockId,
  editor,
  importAssetFromUrl,
  uploadAssetRecord,
  onClose,
}: {
  blockId: string;
  editor: BlockNoteEditor<any>;
  importAssetFromUrl: CustomBlockContext['importAssetFromUrl'];
  uploadAssetRecord: CustomBlockContext['uploadAssetRecord'];
  onClose: () => void;
}) {
  const block = editor.getBlock(blockId) as { id: string; props: Record<string, unknown> } | undefined;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; parentWidth: number; pointerId: number } | null>(null);

  const state = block ? readGalleryState(block) : { images: [], mode: 'grid' as const, groupCaption: '', columns: 3, width: 100 };
  const { images, mode, groupCaption, columns, width } = state;
  const renderedWidth = draftWidth ?? width;
  const safeActiveIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeActiveIndex];

  useEffect(() => {
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', dismissWithEscape, true);
    return () => document.removeEventListener('keydown', dismissWithEscape, true);
  }, [onClose]);

  if (!block) {
    return null;
  }

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props } as never);
  };

  const updateImages = (nextImages: GalleryImage[]) => updateBlock({ images: JSON.stringify(nextImages), mode, columns, groupCaption, width });

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

  const addUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    try {
      const parsed = new URL(trimmedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Enter a valid HTTP(S) image URL.');
      }
      const asset = await importAssetFromUrl(parsed.toString());
      updateImages([...images, { url: `/api/assets/${asset.id}`, name: asset.filename, caption: '' }]);
      setUrl('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image import failed');
    }
  };

  const addUploads = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    try {
      const uploaded = await Promise.all(files.map(uploadAssetRecord));
      updateImages([...images, ...uploaded.map((asset) => ({ url: `/api/assets/${asset.id}`, name: asset.filename, caption: '' }))]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally {
      event.currentTarget.value = '';
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
    <section className="gallery-widget-shell" aria-label="Gallery settings">
      <header className="gallery-widget-shell-header">
        <div>
          <p className="gallery-widget-kicker">Widget settings</p>
          <h2>Gallery</h2>
        </div>
        <button type="button" className="gallery-widget-close" onClick={onClose}>Close</button>
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
              <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
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
          <div className="gallery-widget-section">
            <label className="gallery-widget-field">Display
              <select value={mode} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode: event.target.value, columns, groupCaption, width })}>
                <option value="grid">Grid</option>
                <option value="single">Single image</option>
              </select>
            </label>
            <label className="gallery-widget-field">Width
              <input type="range" min={5} max={100} step={1} value={renderedWidth} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, columns, groupCaption, width: Number(event.currentTarget.value) })} />
            </label>
            <label className="gallery-widget-field">Group caption
              <input type="text" value={groupCaption} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, columns, groupCaption: event.target.value, width })} placeholder="Add a group caption" />
            </label>
          </div>

          <div className="gallery-widget-section">
            <form className="gallery-widget-url-form" onSubmit={addUrl}>
              <label className="gallery-widget-field">Image URL
                <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/image.jpg" />
              </label>
              <button type="submit" disabled={!url.trim()}>Add URL</button>
            </form>
            <label className="gallery-widget-upload">Upload images
              <input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={addUploads} />
            </label>
            {error ? <p className="gallery-error" role="alert">{error}</p> : null}
          </div>

          <div className="gallery-widget-section">
            <h3>Captions</h3>
            <div className="gallery-widget-caption-grid">
              {images.map((image, index) => <label key={`caption-${image.url}-${index}`} className="gallery-widget-field">Caption {index + 1}
                <input type="text" value={image.caption ?? ''} onChange={(event) => updateCaption(index, event.target.value)} placeholder="Add a caption" />
              </label>)}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

const pageLinkBlock: CustomBlockRegistration = {
  type: 'pageLink',
  create: ({ referencedPages }) => createReactBlockSpec(
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
      render: (props) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const reference = pageId
          ? referencedPages.get(pageId) ?? { title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null }
          : { title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null };
        const label = `${reference.icon ? `${reference.icon} ` : ''}${reference.title || String(propsByType.title || 'Page')}`;
        const href = externalUrl || (pageId ? `/page/${pageId}` : '#');

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
            <span className="page-link-icon" aria-hidden="true">{reference.icon || '📄'}</span>
            <span className="page-link-title">{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
      toExternalHTML: (props) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const reference = pageId
          ? referencedPages.get(pageId) ?? { title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null }
          : { title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null };
        return (
          <a href={externalUrl || (pageId ? `/page/${pageId}` : '#')} target={externalUrl ? '_blank' : undefined} rel={externalUrl ? 'noreferrer' : undefined}>
            <span aria-hidden="true">{reference.icon || '📄'}</span>
            <span>{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
    },
  )(),
};

const youtubeBlock: CustomBlockRegistration = {
  type: 'youtube',
  create: () => createReactBlockSpec(
    {
      type: 'youtube',
      propSchema: { url: { default: '' } },
      content: 'none',
    },
    {
      render: (props) => <YouTubeBlock block={props.block as unknown as { id: string; props: Record<string, unknown> }} editor={props.editor} />,
      toExternalHTML: (props) => {
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
  create: ({ importAssetFromUrl, uploadAssetRecord }) => createReactBlockSpec(
    {
      type: 'gallery',
      propSchema: {
        images: { default: '[]' },
        columns: { default: 3 },
        mode: { default: 'grid' },
        captionMode: { default: 'individual' },
        groupCaption: { default: '' },
        width: { default: 100 },
      },
      content: 'none',
    },
    {
      render: (props) => (
        <GalleryBlock
          block={props.block as unknown as { id: string; props: Record<string, unknown> }}
          editor={props.editor}
          importAssetFromUrl={importAssetFromUrl}
          uploadAssetRecord={uploadAssetRecord}
        />
      ),
      toExternalHTML: (props) => {
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
