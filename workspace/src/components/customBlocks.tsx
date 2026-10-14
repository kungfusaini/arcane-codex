/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BlockNoteEditor, BlockSpec, PartialBlock } from '@blocknote/core';
import { createReactBlockSpec, type DefaultReactSuggestionItem } from '@blocknote/react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type TouchEvent } from 'react';
import { PageIcon } from '@/components/PageIcon';
import { buildWorkspacePagePathFromPages } from '@/lib/workspaceHome';
import { editGrabberImageToAsset, normalizeHttpUrl } from '@/lib/imageGrabber';
import { ImageGrabberPromptForm, ImageGrabberStrip, ImageGrabberUrlForm, WikimediaCommonsSearch } from '@/components/ImageGrabberControls';
import { PublishMediaModal, type PublishMediaItem } from '@/components/PublishMediaModal';
import { clearYouTubeDockSession, requestYouTubeDockCommand, setYouTubeDockSession, updateYouTubeDockSession, useYouTubeDockSession } from '@/components/youtubeDock';

export type ReferencedPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  slug?: string | null;
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

type ArtworkFrame = {
  url: string;
};

const galleryImageSizeMin = 120;
const galleryImageSizeMax = 480;
const galleryImageSizeDefault = 240;
const galleryImageSizeStep = 8;

function readGalleryImageSize(value: unknown): number {
  if (value === 'small') return 160;
  if (value === 'large') return 320;
  if (value === 'medium') return galleryImageSizeDefault;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return galleryImageSizeDefault;
  const stepped = Math.round(numeric / galleryImageSizeStep) * galleryImageSizeStep;
  return Math.min(galleryImageSizeMax, Math.max(galleryImageSizeMin, stepped));
}

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
  const imageSize = readGalleryImageSize(block.props.imageSize);
  return { images, mode, groupCaption, imageSize };
}

function readArtworkFrames(value: unknown): ArtworkFrame[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ArtworkFrame => (
      typeof item === 'object'
      && item !== null
      && typeof (item as ArtworkFrame).url === 'string'
      && Boolean((item as ArtworkFrame).url)
    ));
  } catch {
    return [];
  }
}

function getGalleryBlockStyle(imageSize: number): CSSProperties {
  return {
    '--gallery-image-size': `${imageSize}px`,
  } as CSSProperties;
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
  const blockRef = useRef<HTMLElement | null>(null);
  const latestStateRef = useRef({ currentTime: 0, duration: 0, isPlaying: false, hasStarted: false, isDocked: false, videoId: '' as string | null, url: '' });
  const videoId = getYouTubeVideoId(String(block.props.url || ''));
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  };
  const dockSession = useYouTubeDockSession();
  const activeDockSession = dockSession?.sourceBlockId === block.id ? dockSession : null;
  const activeDockSessionIsVisible = activeDockSession?.isVisible;
  const activeDockSessionSourceBlockId = activeDockSession?.sourceBlockId;
  const displayedCurrentTime = activeDockSession?.currentTime ?? currentTime;
  const displayedDuration = activeDockSession?.duration ?? duration;
  const displayedIsPlaying = activeDockSession?.isPlaying ?? isPlaying;
  const hasActivePlayback = hasStarted || Boolean(activeDockSession);
  const publishDockSession = (next: { currentTime: number; duration: number; isPlaying: boolean; isVisible?: boolean }) => {
    if (!videoId) return;
    const nextSession = {
      sourceBlockId: block.id,
      videoId,
      url,
      title: 'Incubus — Drive',
      currentTime: next.currentTime,
      duration: next.duration,
      isPlaying: next.isPlaying,
      isVisible: next.isVisible ?? isDocked,
    };
    if (
      dockSession?.sourceBlockId === nextSession.sourceBlockId
      && dockSession.videoId === nextSession.videoId
      && dockSession.url === nextSession.url
      && dockSession.title === nextSession.title
      && dockSession.currentTime === nextSession.currentTime
      && dockSession.duration === nextSession.duration
      && dockSession.isPlaying === nextSession.isPlaying
      && dockSession.isVisible === nextSession.isVisible
    ) {
      return;
    }
    setYouTubeDockSession(nextSession);
  };
  const sendCommand = useCallback((command: 'playVideo' | 'pauseVideo' | 'getCurrentTime' | 'getDuration' | 'seekTo', args: unknown[] = []) => {
    requestYouTubeDockCommand({ sourceBlockId: block.id, command, args });
  }, [block.id]);
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
        setIsDocked(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [videoId]);
  useEffect(() => {
    const handleSeek = (event: Event) => {
      const seconds = (event as CustomEvent<{ seconds?: number }>).detail?.seconds;
      if (typeof seconds !== 'number' || seconds < 0) return;
      setCurrentTime(seconds);
      updateYouTubeDockSession({ currentTime: seconds });
      sendCommand('seekTo', [seconds, true]);
    };
    window.addEventListener('arcane-youtube-seek', handleSeek);
    return () => {
      window.removeEventListener('arcane-youtube-seek', handleSeek);
    };
  }, [block.id, sendCommand]);
  latestStateRef.current = { currentTime: displayedCurrentTime, duration: displayedDuration, isPlaying: displayedIsPlaying, hasStarted: hasActivePlayback, isDocked, videoId: videoId ?? '', url };
  useEffect(() => {
    if (!activeDockSessionSourceBlockId || activeDockSessionIsVisible === isDocked) return;
    updateYouTubeDockSession({ isVisible: isDocked });
  }, [activeDockSessionIsVisible, activeDockSessionSourceBlockId, isDocked]);
  useEffect(() => () => {
    const latest = latestStateRef.current;
    if (latest.isPlaying && latest.videoId) {
      setYouTubeDockSession({
        sourceBlockId: block.id,
        videoId: latest.videoId,
        url: latest.url,
        title: 'Incubus — Drive',
        currentTime: latest.currentTime,
        duration: latest.duration,
        isPlaying: true,
        isVisible: true,
      });
    } else {
      clearYouTubeDockSession(block.id);
    }
  }, [block.id]);
  const togglePlayback = () => {
    const nextPlaying = !displayedIsPlaying;
    setIsPlaying(nextPlaying);
    setHasStarted(true);
    publishDockSession({ currentTime: displayedCurrentTime, duration: displayedDuration, isPlaying: nextPlaying });
    sendCommand(nextPlaying ? 'playVideo' : 'pauseVideo');
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
      className={`youtube-block youtube-compact ${videoId ? 'youtube-has-video' : 'youtube-needs-url'} ${isDocked && hasActivePlayback ? 'youtube-block--docked' : ''}`}
      contentEditable={false}
      aria-label="YouTube video"
    >
      {videoId ? <div className="youtube-custom-player youtube-inline-player">
        <button type="button" className="youtube-play-button" onClick={togglePlayback} aria-label={displayedIsPlaying ? 'Pause audio' : 'Play audio'}>
          <span aria-hidden="true">{displayedIsPlaying ? 'Ⅱ' : '▶'}</span>
        </button>
        <div className="youtube-track-copy"><strong>Incubus — Drive</strong><span>Audio from YouTube</span></div>
        <span className="youtube-playing-state visually-hidden" aria-live="polite">{displayedIsPlaying ? 'Playing' : 'Ready'}</span>
        <span className="youtube-time" aria-label={`Current time ${formatTime(displayedCurrentTime)} of ${displayedDuration ? formatTime(displayedDuration) : 'unknown'}`}>{formatTime(displayedCurrentTime)} / {displayedDuration ? formatTime(displayedDuration) : '--:--'}</span>
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
          max={displayedDuration || 240}
          step="1"
          value={Math.min(displayedCurrentTime, displayedDuration || 1)}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            setCurrentTime(nextTime);
            updateYouTubeDockSession({ currentTime: nextTime });
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const { images, mode, groupCaption, imageSize } = readGalleryState(block);
  const editorOpen = !readOnly && block.props.editorOpen === true;
  const galleryStyle = getGalleryBlockStyle(imageSize);
  const safeActiveIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeActiveIndex];
  const lightboxItems: PublishMediaItem[] = images.map((image) => ({
    type: 'image',
    src: image.url,
    alt: image.name,
    caption: image.caption,
    label: image.name,
  }));

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props: { ...block.props, ...props } } as never);
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
    <>
      <section className={`gallery-block gallery-mode-${mode}`} contentEditable={false} tabIndex={0} aria-label="Image gallery" style={galleryStyle} onClickCapture={readOnly ? undefined : (event) => {
        if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
        updateBlock({ editorOpen: true });
      }}>
        {mode === 'single' && activeImage ? (
          <>
            <div className={`gallery-single ${images.length > 1 ? 'gallery-single-navigable' : 'gallery-single-static'}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-previous" onClick={() => move(-1)} aria-label="Previous image">‹</button> : null}
              <figure className="gallery-item">
                {readOnly ? (
                  <button type="button" className="publish-media-trigger gallery-image-trigger" onClick={() => setLightboxIndex(safeActiveIndex)} aria-label={`Open ${activeImage.name}`}>
                    <img src={activeImage.url} alt={activeImage.name} />
                  </button>
                ) : <img src={activeImage.url} alt={activeImage.name} />}
                {activeImage.caption ? <figcaption>{activeImage.caption}</figcaption> : null}
              </figure>
              {images.length > 1 ? <button type="button" className="gallery-nav gallery-nav-next" onClick={() => move(1)} aria-label="Next image">›</button> : null}
            </div>
            {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
          </>
        ) : images.length ? (
          <div className="gallery-grid">
            {images.map((image, index) => (
              <figure className="gallery-item" key={`${image.url}-${index}`}>
                {readOnly ? (
                  <button type="button" className="publish-media-trigger gallery-image-trigger" onClick={() => setLightboxIndex(index)} aria-label={`Open ${image.name}`}>
                    <img src={image.url} alt={image.name} />
                  </button>
                ) : <img src={image.url} alt={image.name} />}
                {image.caption ? <figcaption>{image.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        ) : <p className="gallery-empty">No images yet. Open settings to add one.</p>}
        {groupCaption ? <figcaption className="gallery-group-caption">{groupCaption}</figcaption> : null}
      </section>
      <PublishMediaModal items={lightboxItems} activeIndex={lightboxIndex} onActiveIndexChange={setLightboxIndex} />
    </>
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

  const state = block ? readGalleryState(block) : { images: [], mode: 'grid' as const, groupCaption: '', imageSize: galleryImageSizeDefault };
  const { images, mode, groupCaption, imageSize } = state;
  const galleryStyle = getGalleryBlockStyle(imageSize);
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

  const updateImages = (nextImages: GalleryImage[]) => updateBlock({ images: JSON.stringify(nextImages), mode, imageSize, groupCaption });

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

  const addCommonsImage = async (result: { imageUrl: string; title?: string }) => {
    const asset = await importAssetFromUrl(result.imageUrl);
    updateImages([...images, { url: `/api/assets/${asset.id}`, name: asset.filename, caption: '' }]);
    setActiveIndex(images.length);
    setError('');
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
          <div className={`gallery-block gallery-mode-${mode}`} contentEditable={false} tabIndex={0} aria-label="Image gallery preview" style={galleryStyle}>
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
              <div className="gallery-grid">
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
            <WikimediaCommonsSearch label="Search Wikimedia Commons" useLabel="Add image" onUse={(result) => void addCommonsImage(result)} />
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
              <select value={mode} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode: event.target.value, imageSize, groupCaption })}>
                <option value="grid">Grid</option>
                <option value="single">Single image</option>
              </select>
            </label>
            <label className="gallery-widget-field">Image size
              <input type="range" min={galleryImageSizeMin} max={galleryImageSizeMax} step={galleryImageSizeStep} value={imageSize} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, imageSize: Number(event.currentTarget.value), groupCaption })} />
              <span>{imageSize}px; columns fit automatically</span>
            </label>
            <label className="gallery-widget-field">Group caption
              <input type="text" value={groupCaption} onChange={(event) => updateBlock({ images: JSON.stringify(images), mode, imageSize, groupCaption: event.target.value })} placeholder="Add a group caption" />
            </label>
          </section>
          {error ? <p className="gallery-error" role="alert">{error}</p> : null}
        </aside>
      </div>
    </section>
  );
}

function ArtworkShowcaseBlock({
  block,
  editor,
  readOnly,
}: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockNoteEditor<any>;
  readOnly: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  const title = typeof block.props.title === 'string' && block.props.title.trim() ? block.props.title.trim() : 'Untitled artwork';
  const canvasUrl = typeof block.props.canvasUrl === 'string' ? block.props.canvasUrl.trim() : '';
  const canvasAlt = typeof block.props.canvasAlt === 'string' && block.props.canvasAlt.trim() ? block.props.canvasAlt.trim() : title;
  const prompt = typeof block.props.prompt === 'string' ? block.props.prompt.trim() : '';
  const initialIdea = typeof block.props.initialIdea === 'string' ? block.props.initialIdea.trim() : '';
  const finalPrompt = typeof block.props.finalPrompt === 'string' ? block.props.finalPrompt.trim() : '';
  const turnComments = typeof block.props.turnComments === 'string' ? block.props.turnComments : '';
  const frameUrls = readArtworkFrames(block.props.frameUrls).map((frame) => frame.url);
  const speedValue = Number(block.props.speed);
  const speed = Number.isFinite(speedValue) ? Math.min(4, Math.max(0.25, speedValue)) : 1;
  const strokeCurrentValue = Number(block.props.strokeCurrent);
  const strokeTotalValue = Number(block.props.strokeTotal);
  const strokeTotal = Number.isFinite(strokeTotalValue) ? Math.max(0, Math.floor(strokeTotalValue)) : 0;
  const strokeCurrent = Number.isFinite(strokeCurrentValue) ? Math.min(Math.max(0, Math.floor(strokeCurrentValue)), Math.max(0, strokeTotal - 1)) : 0;
  const currentStrokeLabel = strokeTotal > 0 ? `${strokeCurrent + 1} / ${strokeTotal}` : '0 / 0';

  const updateBlock = (props: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props: { ...block.props, ...props } } as never);
  };

  const frameCount = frameUrls.length;
  const clampFrameIndex = (index: number) => {
    if (frameCount < 1) return 0;
    return Math.max(0, Math.min(frameCount - 1, index));
  };
  const frameIndexFromStroke = (stroke: number) => {
    if (frameCount < 2 || strokeTotal < 1) return frameCount > 1 ? frameCount - 1 : 0;
    return clampFrameIndex(Math.round((Math.max(0, Math.min(stroke, strokeTotal - 1)) / Math.max(1, strokeTotal - 1)) * (frameCount - 1)));
  };
  const [frameIndex, setFrameIndex] = useState(() => frameIndexFromStroke(strokeCurrent));
  const currentFrameLabel = frameCount > 0 ? `${frameIndex + 1} / ${frameCount}` : '0 / 0';
  const turnCommentItems = turnComments
    .split(/\n+/)
    .map((comment) => comment.trim())
    .filter(Boolean);
  const currentComment = turnCommentItems.length && frameCount > 1
    ? turnCommentItems[Math.min(turnCommentItems.length - 1, Math.floor((frameIndex / Math.max(1, frameCount - 1)) * turnCommentItems.length))] || ''
    : '';

  useEffect(() => {
    setFrameIndex(frameIndexFromStroke(strokeCurrent));
  }, [block.id, strokeCurrent, strokeTotal, frameCount]);

  useEffect(() => {
    if (!isPlaying || readOnly || frameCount < 2) return;
    const delay = Math.max(25, Math.round(120 / speed));
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        const next = current + 1;
        if (next >= frameCount) {
          window.clearInterval(timer);
          window.setTimeout(() => setIsPlaying(false), 0);
          updateBlock({ strokeCurrent: Math.max(0, strokeTotal - 1) });
          return frameCount - 1;
        }
        const nextStroke = Math.round((next / Math.max(1, frameCount - 1)) * Math.max(0, strokeTotal - 1));
        updateBlock({ strokeCurrent: nextStroke });
        return next;
      });
    }, delay);
    return () => window.clearInterval(timer);
  }, [frameCount, isPlaying, readOnly, speed, strokeTotal]);

  return (
    <section className="artwork-showcase-block" contentEditable={false} aria-label="Single artwork showcase">
      <header className="artwork-showcase-header">
        <p className="artwork-showcase-prompt"><span>Prompt:</span> <strong>{prompt || 'Untitled'}</strong></p>
      </header>

      <div className="artwork-showcase-body">
        <section className="artwork-showcase-stage" aria-label="Artwork preview">
          <div className="artwork-showcase-canvas" aria-label={`${title} canvas preview`}>
            {frameUrls[frameIndex] || canvasUrl ? <img src={frameUrls[frameIndex] || canvasUrl} alt={canvasAlt} /> : (
              <div className="artwork-showcase-canvas-empty">
                <strong>Canvas preview</strong>
                <span>Rendered artwork will sit here.</span>
              </div>
            )}
          </div>
        </section>

        <aside className="artwork-showcase-aside" aria-label="Playback controls and note">
          <div className="artwork-showcase-metric-line"><span>Frame:</span> <strong>{currentFrameLabel}</strong></div>
          <div className="artwork-showcase-transport">
            <button
              type="button"
              className="artwork-showcase-play"
              onClick={() => {
                setIsPlaying((current) => !current);
              }}
              disabled={readOnly || strokeTotal <= 0}
              aria-pressed={isPlaying}
              aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
            >
              <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
            </button>

            <label className="artwork-showcase-field artwork-showcase-scrubber">
              <span>Seek</span>
              <input
                className="artwork-showcase-range"
                type="range"
                min={0}
                max={Math.max(frameCount - 1, 0)}
                step={1}
                value={frameIndex}
                onChange={(event) => {
                  const nextFrame = Number(event.currentTarget.value);
                  setFrameIndex(nextFrame);
                  const nextStroke = frameCount > 1
                    ? Math.round((nextFrame / Math.max(1, frameCount - 1)) * Math.max(0, strokeTotal - 1))
                    : nextFrame;
                  updateBlock({ strokeCurrent: nextStroke });
                }}
                disabled={readOnly || frameCount <= 0}
                aria-valuetext={`Frame ${currentFrameLabel}`}
              />
            </label>

          </div>

          <label className="artwork-showcase-field artwork-showcase-speed">
            <span>Speed</span>
            <div className="artwork-showcase-speed-control">
              <input
                className="artwork-showcase-range"
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={speed}
                onChange={(event) => updateBlock({ speed: Number(event.currentTarget.value) })}
                disabled={readOnly}
                aria-valuetext={`${speed.toFixed(2)}x`}
              />
              <strong>{speed.toFixed(2)}x</strong>
            </div>
          </label>

          <div className="artwork-showcase-metric-line"><span>Comment:</span> <strong>{currentComment || 'No turn comments yet.'}</strong></div>
        </aside>
      </div>
    </section>
  );
}

const artworkShowcaseBlock: CustomBlockRegistration = {
  type: 'artworkShowcase',
  create: ({ readOnly }) => buildReactBlockSpec(
    {
      type: 'artworkShowcase',
      propSchema: {
        title: { default: 'Untitled artwork' },
        canvasUrl: { default: '' },
        canvasAlt: { default: '' },
        prompt: { default: '' },
        initialIdea: { default: '' },
        turnComments: { default: '' },
        finalPrompt: { default: '' },
        strokeCurrent: { default: 0 },
        strokeTotal: { default: 0 },
        speed: { default: 1 },
        frameUrls: { default: '[]' },
      },
      content: 'none',
    },
    {
      render: (props: any) => <ArtworkShowcaseBlock block={props.block as unknown as { id: string; props: Record<string, unknown> }} editor={props.editor} readOnly={readOnly ?? false} />,
      toExternalHTML: (props: any) => {
        const blockProps = props.block.props as Record<string, unknown>;
        const title = typeof blockProps.title === 'string' && blockProps.title.trim() ? blockProps.title.trim() : 'Untitled artwork';
        const canvasUrl = typeof blockProps.canvasUrl === 'string' ? blockProps.canvasUrl.trim() : '';
        const prompt = typeof blockProps.prompt === 'string' ? blockProps.prompt.trim() : '';
        const initialIdea = typeof blockProps.initialIdea === 'string' ? blockProps.initialIdea.trim() : '';
        const finalPrompt = typeof blockProps.finalPrompt === 'string' ? blockProps.finalPrompt.trim() : '';
        return (
          <figure>
            {canvasUrl ? <img src={canvasUrl} alt={title} /> : null}
            <figcaption>
              <strong>{title}</strong>
              {prompt ? <p>Prompt: {prompt}</p> : null}
              {initialIdea ? <p>Initial idea: {initialIdea}</p> : null}
              {finalPrompt ? <p>Final prompt: {finalPrompt}</p> : null}
            </figcaption>
          </figure>
        );
      },
    },
  )(),
  slashMenu: ({ insertBlock }) => ({
    title: 'Artwork showcase',
    subtext: 'Show one artwork with playback and prompt history',
    group: 'Media',
    onItemClick: () => insertBlock({ type: 'artworkShowcase', props: { title: 'Untitled artwork', canvasUrl: '', canvasAlt: '', prompt: '', initialIdea: '', turnComments: '', finalPrompt: '', strokeCurrent: 0, strokeTotal: 0, speed: 1, frameUrls: '[]' } } as unknown as PartialBlock),
  }),
};

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
        const href = externalUrl || (pageId ? buildWorkspacePagePathFromPages(pageId, referencedPages.size ? Array.from(referencedPages.values()) : [reference], routeBasePath) : '#');

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
            <span className="page-link-arrow" aria-hidden="true">↗</span>
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
          <a href={externalUrl || (pageId ? buildWorkspacePagePathFromPages(pageId, referencedPages.size ? Array.from(referencedPages.values()) : [reference], routeBasePath) : '#')} target={externalUrl ? '_blank' : undefined} rel={externalUrl ? 'noreferrer' : undefined}>
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
        imageSize: { default: galleryImageSizeDefault },
        mode: { default: 'grid' },
        captionMode: { default: 'individual' },
        groupCaption: { default: '' },
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
    onItemClick: () => insertBlock({ type: 'gallery', props: { images: '[]', imageSize: galleryImageSizeDefault, mode: 'grid', captionMode: 'individual', groupCaption: '' } } as unknown as PartialBlock),
  }),
};

/** Trusted, code-authored blocks. Add a registration here; slashMenu is opt-in. */
export const customBlockRegistry: CustomBlockRegistration[] = [pageLinkBlock, youtubeBlock, galleryBlock, artworkShowcaseBlock];

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
