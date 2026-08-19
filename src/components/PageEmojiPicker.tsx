'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type EmojiSelection = {
  native?: string;
};

type GeneratedIconPayload = {
  asset?: { id: string };
  error?: string;
};

type PageEmojiPickerProps = {
  pageId: string;
  currentIcon: string | null;
  currentIconAssetId: string | null;
  onSelect: (emoji: string) => void;
  onSelectAsset: (assetId: string) => void;
  onUploadIcon: () => void;
  onImportIconUrl: (url: string) => Promise<void>;
  onRemove: () => void;
  onClose: (reason: 'escape' | 'outside' | 'button') => void;
};

export function PageEmojiPicker({ pageId, currentIcon, currentIconAssetId, onSelect, onSelectAsset, onUploadIcon, onImportIconUrl, onRemove, onClose }: PageEmojiPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  const assetSelectRef = useRef(onSelectAsset);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [prompt, setPrompt] = useState('');
  const promptStorageKey = `arcane-page-icon-prompt:${pageId}`;
  const [iconUrl, setIconUrl] = useState('');
  const [importState, setImportState] = useState<'idle' | 'importing' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const [generateState, setGenerateState] = useState<'idle' | 'generating' | 'error'>('idle');
  const [generateError, setGenerateError] = useState('');
  selectRef.current = onSelect;
  assetSelectRef.current = onSelectAsset;

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose('outside');
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose('escape');
      }
    };

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape, true);
    };
  }, [onClose]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(promptStorageKey);
      if (stored) {
        setPrompt(stored);
      }
    } catch {
      // ignore storage errors
    }
  }, [promptStorageKey]);

  useEffect(() => {
    try {
      if (prompt.trim()) {
        window.localStorage.setItem(promptStorageKey, prompt);
      } else {
        window.localStorage.removeItem(promptStorageKey);
      }
    } catch {
      // ignore storage errors
    }
  }, [prompt, promptStorageKey]);

  useEffect(() => {
    let active = true;
    const host = hostRef.current;

    void (async () => {
      try {
        const [{ Picker }, dataModule] = await Promise.all([
          import('emoji-mart'),
          import('@emoji-mart/data'),
        ]);
        if (!active || !host) {
          return;
        }
        const picker = new Picker({
          data: dataModule.default ?? dataModule,
          autoFocus: true,
          theme: 'dark',
          set: 'native',
          dynamicWidth: true,
          emojiButtonRadius: '4px',
          maxFrequentRows: 2,
          previewPosition: 'none',
          skinTonePosition: 'search',
          onEmojiSelect: (selection: EmojiSelection) => {
            if (selection.native) {
              selectRef.current(selection.native);
            }
          },
        });
        host.replaceChildren(picker as unknown as Node);
        setLoadState('ready');
      } catch {
        if (active) {
          setLoadState('error');
        }
      }
    })();

    return () => {
      active = false;
      host?.replaceChildren();
    };
  }, [loadAttempt]);

  const submitGeneratedIcon = async (requestedPrompt: string) => {
    const trimmed = requestedPrompt.trim();
    if (!trimmed || generateState === 'generating') return;

    setGenerateState('generating');
    setGenerateError('');
    try {
      const response = await fetch('/api/page-icon-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const payload = await response.json() as GeneratedIconPayload;
      if (!response.ok || !payload.asset?.id) {
        throw new Error(payload.error || 'Icon generation failed.');
      }
      assetSelectRef.current(payload.asset.id);
      setPrompt(trimmed);
      setGenerateState('idle');
    } catch (error) {
      setGenerateState('error');
      setGenerateError(error instanceof Error ? error.message : 'Icon generation failed.');
    }
  };

  const addIconFromUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = iconUrl.trim();
    if (!trimmed || importState === 'importing') return;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Use an HTTP(S) image URL.');
      }
      setImportState('importing');
      setImportError('');
      await onImportIconUrl(parsed.toString());
      setImportState('idle');
      setIconUrl('');
    } catch (error) {
      setImportState('error');
      setImportError(error instanceof Error ? error.message : 'Image import failed.');
    }
  };

  const generateIcon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitGeneratedIcon(prompt);
  };
  return (
    <div ref={rootRef} className="emoji-popover" role="dialog" aria-label="Choose page icon">
      <div className="emoji-popover-header">
        <strong>Choose an icon</strong>
        <div className="emoji-popover-actions">
          {currentIcon || currentIconAssetId ? <button type="button" onClick={onRemove}>Remove</button> : null}
          <button type="button" aria-label="Close emoji picker" onClick={() => onClose('button')}>×</button>
        </div>
      </div>

      <form className="generated-icon-form" onSubmit={(event) => void generateIcon(event)}>
        <label htmlFor="generated-page-icon-prompt">Generate icon</label>
        <div className="generated-icon-form-row">
          <input
            id="generated-page-icon-prompt"
            value={prompt}
            onChange={(event) => { setPrompt(event.target.value); setGenerateError(''); setGenerateState('idle'); }}
            placeholder="Dark wizard tome with red details"
            disabled={generateState === 'generating'}
            maxLength={300}
          />
          <button type="submit" className="primary-btn" disabled={!prompt.trim() || generateState === 'generating'}>{generateState === 'generating' ? 'Generating…' : 'Generate'}</button>
          {currentIconAssetId ? (
            <button
              type="button"
              className="mini-btn"
              disabled={!prompt.trim() || generateState === 'generating'}
              onClick={() => void submitGeneratedIcon(prompt)}
            >
              Regenerate
            </button>
          ) : null}
        </div>
        {generateState === 'generating' ? <p role="status">Creating a compact emoji-style icon…</p> : null}
        {generateState === 'error' ? <p role="alert">{generateError}</p> : null}
      </form>

      <div className="emoji-picker-divider"><span>or pick a standard emoji</span></div>
      {loadState === 'loading' ? <div className="emoji-picker-state" role="status">Loading emojis…</div> : null}
      {loadState === 'error' ? (
        <div className="emoji-picker-state error" role="alert">
          <span>Emoji picker could not load.</span>
          <button type="button" onClick={() => { setLoadState('loading'); setLoadAttempt((attempt) => attempt + 1); }}>Retry</button>
        </div>
      ) : null}
      <div ref={hostRef} className="emoji-picker-host" hidden={loadState === 'error'} />

      <div className="emoji-picker-divider"><span>or upload an icon image</span></div>
      <div className="generated-icon-form">
        <div className="generated-icon-form-row">
          <button type="button" onClick={onUploadIcon} disabled={generateState === 'generating' || importState === 'importing'}>Upload image</button>
        </div>
      </div>

      <div className="emoji-picker-divider"><span>or paste an icon image URL</span></div>
      <form className="generated-icon-form" onSubmit={(event) => void addIconFromUrl(event)}>
        <label htmlFor="generated-page-icon-url">Icon image URL</label>
        <div className="generated-icon-form-row">
          <input
            id="generated-page-icon-url"
            type="url"
            value={iconUrl}
            onChange={(event) => { setIconUrl(event.target.value); setImportError(''); setImportState('idle'); }}
            placeholder="https://example.com/icon.png"
            disabled={importState === 'importing' || generateState === 'generating'}
            maxLength={2048}
          />
          <button type="submit" className="primary-btn" disabled={!iconUrl.trim() || importState === 'importing' || generateState === 'generating'}>
            {importState === 'importing' ? 'Importing…' : 'Use image URL'}
          </button>
        </div>
        {importState === 'importing' ? <p role="status">Downloading icon image…</p> : null}
        {importState === 'error' ? <p role="alert">{importError}</p> : null}
      </form>
    </div>
  );
}
