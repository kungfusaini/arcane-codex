import { useState, type CSSProperties, type ClipboardEvent, type FormEvent, type ReactNode, type Ref } from 'react';
import { searchWikimediaCommonsImages, type WikimediaCommonsImageResult } from '@/lib/imageGrabber';

export type ImageGrabberItem = {
  url: string;
  name: string;
  caption?: string;
};

type ImageGrabberUrlFormProps = {
  label: string;
  inputId?: string;
  value: string;
  placeholder?: string;
  submitLabel: string;
  cancelLabel?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  className?: string;
  fieldClassName?: string;
  submitClassName?: string;
  style?: CSSProperties;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
  children?: ReactNode;
};

type ImageGrabberPanelProps = {
  title: string;
  description?: string;
  className?: string;
  style?: CSSProperties;
  onPaste?: (event: ClipboardEvent<HTMLElement>) => void;
  children: ReactNode;
};

export function ImageGrabberPanel({ title, description, className = 'image-grabber-panel', style, onPaste, children }: ImageGrabberPanelProps) {
  return (
    <section className={className} style={style} aria-label={title} onPaste={onPaste as never} tabIndex={0}>
      <div className="image-grabber-panel-header">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="image-grabber-panel-body">{children}</div>
    </section>
  );
}

type ImageGrabberUploadButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export function ImageGrabberUploadButton({ label, disabled = false, onClick }: ImageGrabberUploadButtonProps) {
  return <button type="button" disabled={disabled} onClick={onClick}>{label}</button>;
}

export function extractGrabberPaste(event: ClipboardEvent<HTMLElement>): { text: string | null; imageFile: File | null } {
  const text = event.clipboardData.getData('text/plain').trim() || null;
  const imageFile = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/')) ?? null;
  return { text, imageFile };
}

export function ImageGrabberUrlForm({
  label,
  inputId,
  value,
  placeholder = 'https://example.com/image.jpg',
  submitLabel,
  cancelLabel = 'Cancel',
  autoFocus = false,
  inputRef,
  disabled = false,
  className = 'media-url-form',
  fieldClassName,
  submitClassName = 'primary-btn',
  style,
  onChange,
  onSubmit,
  onCancel,
  children,
}: ImageGrabberUrlFormProps) {
  const input = (
    <input
      id={inputId}
      ref={inputRef}
      type="url"
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );

  return (
    <form className={className} aria-label={label} style={style} onSubmit={onSubmit}>
      {inputId ? (
        <label htmlFor={inputId} className={fieldClassName}>{label}{input}</label>
      ) : (
        <label className={fieldClassName}>{label}{input}</label>
      )}
      <button type="submit" className={submitClassName} disabled={disabled || !value.trim()}>{submitLabel}</button>
      {children}
      {onCancel ? <button type="button" onClick={onCancel}>{cancelLabel}</button> : null}
    </form>
  );
}

type WikimediaCommonsSearchProps = {
  label?: string;
  defaultQuery?: string;
  disabled?: boolean;
  useLabel?: string;
  onUse: (result: WikimediaCommonsImageResult) => Promise<void> | void;
};

export function WikimediaCommonsSearch({ label = 'Search Wikimedia Commons', defaultQuery = '', disabled = false, useLabel = 'Use image', onUse }: WikimediaCommonsSearchProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<WikimediaCommonsImageResult[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [error, setError] = useState('');
  const [usingId, setUsingId] = useState<string | null>(null);

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || state === 'loading') return;
    setState('loading');
    setError('');
    try {
      const nextResults = await searchWikimediaCommonsImages(trimmed);
      setResults(nextResults);
      setState(nextResults.length ? 'ready' : 'empty');
    } catch (cause) {
      setResults([]);
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Wikimedia Commons search failed.');
    }
  };

  const useResult = async (result: WikimediaCommonsImageResult) => {
    if (disabled || usingId) return;
    setUsingId(result.id);
    setError('');
    try {
      await onUse(result);
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Image import failed.');
    } finally {
      setUsingId(null);
    }
  };

  return (
    <div className="commons-search" aria-label={label}>
      <form className="commons-search-form" onSubmit={submitSearch}>
        <label>{label}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search public domain and Creative Commons images" disabled={disabled || state === 'loading'} /></label>
        <button type="submit" className="primary-btn" disabled={disabled || state === 'loading' || !query.trim()}>{state === 'loading' ? 'Searching…' : 'Search'}</button>
      </form>
      {state === 'loading' ? <p className="commons-search-state" role="status">Searching Wikimedia Commons…</p> : null}
      {state === 'empty' ? <p className="commons-search-state">No supported PNG, JPEG, GIF, WebP, or SVG images found.</p> : null}
      {state === 'error' ? <p className="commons-search-state error" role="alert">{error}</p> : null}
      {results.length ? (
        <div className="commons-search-results" aria-label="Wikimedia Commons results">
          {results.map((result) => (
            <article className="commons-search-result" key={result.id}>
              <img src={result.thumbnailUrl} alt="" loading="lazy" />
              <div>
                <strong>{result.title}</strong>
                <span>{result.license}{result.creator ? ` · ${result.creator}` : ''}{result.width && result.height ? ` · ${result.width}×${result.height}` : ''}</span>
                {result.description ? <p>{result.description}</p> : null}
                <a href={result.pageUrl} target="_blank" rel="noreferrer">View source</a>
              </div>
              <button type="button" onClick={() => void useResult(result)} disabled={disabled || Boolean(usingId)}>{usingId === result.id ? 'Importing…' : useLabel}</button>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ImageGrabberPromptFormProps = {
  label: string;
  inputId?: string;
  value: string;
  placeholder?: string;
  submitLabel: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className: string;
  fieldClassName?: string;
  submitClassName?: string;
  visuallyHiddenLabel?: boolean;
  heading?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ImageGrabberPromptForm({
  label,
  inputId,
  value,
  placeholder = 'Describe the edit…',
  submitLabel,
  busyLabel = 'Applying…',
  busy = false,
  disabled = false,
  autoFocus = false,
  className,
  fieldClassName,
  submitClassName = 'primary-btn',
  visuallyHiddenLabel = false,
  heading,
  onChange,
  onSubmit,
}: ImageGrabberPromptFormProps) {
  return (
    <form className={className} onSubmit={onSubmit}>
      {heading}
      <label htmlFor={inputId} className={visuallyHiddenLabel ? 'visually-hidden' : fieldClassName}>{label}</label>
      <input
        id={inputId}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={busy || disabled}
      />
      <button type="submit" className={submitClassName} disabled={busy || disabled || !value.trim()}>{busy ? busyLabel : submitLabel}</button>
    </form>
  );
}

type ImageGrabberStripProps = {
  images: ImageGrabberItem[];
  activeIndex: number;
  addLabel?: string;
  onSelect: (index: number) => void;
  onAdd: () => void;
};

export function ImageGrabberStrip({ images, activeIndex, addLabel = '+ Add', onSelect, onAdd }: ImageGrabberStripProps) {
  return (
    <div className="gallery-widget-image-strip" aria-label="Gallery images">
      {images.map((image, index) => (
        <button
          key={`select-${image.url}-${index}`}
          type="button"
          className={`gallery-widget-image-chip ${index === activeIndex ? 'is-selected' : ''}`}
          onClick={() => onSelect(index)}
          aria-pressed={index === activeIndex}
          title={image.name}
        >
          <img src={image.url} alt="" aria-hidden="true" />
          <span>{index + 1}</span>
        </button>
      ))}
      <button type="button" className="gallery-widget-image-chip gallery-widget-add-chip" onClick={onAdd}>{addLabel}</button>
    </div>
  );
}
