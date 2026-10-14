'use client';

import { type ClipboardEvent, type CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { extractGrabberPaste, ImageGrabberPanel, ImageGrabberPromptForm, ImageGrabberUploadButton, ImageGrabberUrlForm, WikimediaCommonsSearch } from '@/components/ImageGrabberControls';
import { ImageGrabberPopup, ImagePopupSection } from '@/components/ImageGrabberPopup';

type EmojiSelection = {
  native?: string;
};

type GeneratedIconPayload = {
  asset?: { id: string; filename?: string; mimeType?: string; sha256?: string; size?: number; width?: number | null; height?: number | null; prompt?: string | null; createdAt?: number };
  error?: string;
};

type PageEmojiPickerProps = {
  pageId: string;
  currentIcon: string | null;
  currentIconAssetId: string | null;
  onSelect: (emoji: string) => void;
  onSelectAsset: (assetId: string, asset?: NonNullable<GeneratedIconPayload['asset']>) => void;
  onUploadIconFile: (file: File) => Promise<void>;
  onImportIconUrl: (url: string) => Promise<void>;
  onImportIconCommons: (result: { imageUrl: string }) => Promise<void>;
  onRemove: () => void;
  onClose: (reason: 'escape' | 'outside' | 'button') => void;
  onPromptChange?: (prompt: string) => void;
  style?: CSSProperties;
};

export function PageEmojiPicker({ pageId, currentIcon, currentIconAssetId, onSelect, onSelectAsset, onUploadIconFile, onImportIconUrl, onImportIconCommons, onRemove, onClose, onPromptChange, style }: PageEmojiPickerProps) {
  const rootRef = useRef<HTMLElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef(onSelect);
  const assetSelectRef = useRef(onSelectAsset);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
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
        onPromptChange?.(stored.trim());
      } else {
        onPromptChange?.('');
      }
    } catch {
      // ignore storage errors
    }
  }, [onPromptChange, promptStorageKey]);

  useEffect(() => {
    onPromptChange?.(prompt.trim());
    try {
      if (prompt.trim()) {
        window.localStorage.setItem(promptStorageKey, prompt);
      } else {
        window.localStorage.removeItem(promptStorageKey);
      }
    } catch {
      // ignore storage errors
    }
  }, [onPromptChange, prompt, promptStorageKey]);

  const setEmojiPickerHost = useCallback((node: HTMLDivElement | null) => {
    setHostNode(node);
  }, []);

  useEffect(() => {
    if (!hostNode) {
      return;
    }

    let active = true;
    setLoadState('loading');

    void (async () => {
      try {
        const [emojiMartModule, dataModule] = await Promise.all([
          import('emoji-mart'),
          import('@emoji-mart/data'),
        ]);
        const emojiMart = (emojiMartModule.default ?? emojiMartModule) as { Picker?: new (options: Record<string, unknown>) => unknown };
        const Picker = emojiMart.Picker;
        if (!Picker) {
          throw new Error('Emoji picker module did not export Picker.');
        }
        if (!active) {
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
        hostNode.replaceChildren(picker as unknown as Node);
        setLoadState('ready');
      } catch {
        if (active) {
          setLoadState('error');
        }
      }
    })();

    return () => {
      active = false;
      hostNode.replaceChildren();
    };
  }, [hostNode, loadAttempt]);

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
      assetSelectRef.current(payload.asset.id, payload.asset);
      setPrompt(trimmed);
      setGenerateState('idle');
    } catch (error) {
      setGenerateState('error');
      setGenerateError(error instanceof Error ? error.message : 'Icon generation failed.');
    }
  };

  const generateIcon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitGeneratedIcon(prompt);
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

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const { text, imageFile } = extractGrabberPaste(event);
    if (imageFile) {
      event.preventDefault();
      void onUploadIconFile(imageFile);
      return;
    }
    if (text) {
      try {
        const parsed = new URL(text);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          event.preventDefault();
          setIconUrl(parsed.toString());
        }
      } catch {
        // ignore non-URL paste
      }
    }
  };

  const handleUpload = () => uploadInputRef.current?.click();
  const iconPrompt = prompt.trim();
  const hasEmojiIcon = Boolean(currentIcon && !currentIconAssetId);
  const hasImageIcon = Boolean(currentIconAssetId);

  return (
    <ImageGrabberPopup
      title={currentIcon || currentIconAssetId ? 'Icon' : 'Add icon'}
      className="image-grabber-popup emoji-popover"
      showSettings
      defaultPage={currentIcon || currentIconAssetId ? 'info' : 'settings'}
      rootRef={rootRef}
      style={style}
      onClose={() => onClose('button')}
      info={(
        <div className="emoji-popover-inner" role="dialog" aria-label="Page icon information">
          <ImagePopupSection>
            {currentIcon ? <div className="image-popup-emoji-preview">{currentIcon}</div> : null}
            {currentIconAssetId ? (
              <div className="image-popup-preview-frame">
                <img className="image-popup-preview" src={`/api/assets/${currentIconAssetId}`} alt="Page icon" />
              </div>
            ) : null}
            {hasImageIcon && iconPrompt ? <p className="help">Prompt: {iconPrompt}</p> : null}
            {currentIcon || currentIconAssetId ? (
              <div className="toolbar"><button type="button" className="primary-btn" onClick={() => window.open(currentIconAssetId ? `/api/assets/${currentIconAssetId}` : `https://emojipedia.org/${encodeURIComponent(currentIcon ?? '')}`, '_blank')}>{currentIconAssetId ? 'Open image' : 'Open emoji'}</button></div>
            ) : <p className="help">No icon selected.</p>}
          </ImagePopupSection>
        </div>
      )}
      settings={(
        <div className="emoji-popover-inner" role="dialog" aria-label="Choose page icon" onPaste={handlePaste}>
          {hasEmojiIcon ? (
            <ImagePopupSection>
              <p className="help">This page already uses an emoji icon.</p>
            </ImagePopupSection>
          ) : null}
          {hasImageIcon ? (
            <ImagePopupSection editorOnly>
              {iconPrompt ? <p className="help">Prompt: {iconPrompt}</p> : null}
              <ImageGrabberPanel title="Icon image" description="Generate, upload, paste a link, paste an image, or search Wikimedia Commons." className="image-grabber-panel icon-grabber-panel">
                <WikimediaCommonsSearch label="Search Wikimedia Commons" useLabel="Use as icon" onUse={(result) => onImportIconCommons(result)} />
                <ImageGrabberPromptForm
                  label="Generate icon"
                  inputId="generated-page-icon-prompt"
                  value={prompt}
                  placeholder="Dark wizard tome with red details"
                  submitLabel="Generate"
                  busyLabel="Generating…"
                  busy={generateState === 'generating'}
                  className="generated-icon-form"
                  onChange={(value) => { setPrompt(value); setGenerateError(''); setGenerateState('idle'); }}
                  onSubmit={(event) => void generateIcon(event)}
                />
                <div className="generated-icon-form-row"><button type="button" className="mini-btn" disabled={!iconPrompt || generateState === 'generating'} onClick={() => void submitGeneratedIcon(prompt)}>Regenerate current icon</button></div>
                {generateState === 'generating' ? <p role="status">Creating a compact emoji-style icon…</p> : null}
                {generateState === 'error' ? <p role="alert">{generateError}</p> : null}
                <div className="generated-icon-form-row"><ImageGrabberUploadButton label="Upload image" disabled={generateState === 'generating' || importState === 'importing'} onClick={handleUpload} /></div>
                <ImageGrabberUrlForm
                  label="Icon image URL"
                  inputId="generated-page-icon-url"
                  value={iconUrl}
                  placeholder="https://example.com/icon.png"
                  submitLabel={importState === 'importing' ? 'Importing…' : 'Use image URL'}
                  disabled={importState === 'importing' || generateState === 'generating'}
                  className="generated-icon-form"
                  onChange={(value) => { setIconUrl(value); setImportError(''); setImportState('idle'); }}
                  onSubmit={(event) => void addIconFromUrl(event)}
                />
                {importState === 'importing' ? <p role="status">Downloading icon image…</p> : null}
                {importState === 'error' ? <p role="alert">{importError}</p> : null}
                <input ref={uploadInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void onUploadIconFile(file);
                }} />
              </ImageGrabberPanel>
            </ImagePopupSection>
          ) : null}
          {!hasEmojiIcon && !hasImageIcon ? (
            <>
              <ImagePopupSection editorOnly>
                <ImageGrabberPanel title="Icon image" description="Generate, upload, paste a link, paste an image, or search Wikimedia Commons." className="image-grabber-panel icon-grabber-panel">
                  <WikimediaCommonsSearch label="Search Wikimedia Commons" useLabel="Use as icon" onUse={(result) => onImportIconCommons(result)} />
                  <ImageGrabberPromptForm
                    label="Generate icon"
                    inputId="generated-page-icon-prompt"
                    value={prompt}
                    placeholder="Dark wizard tome with red details"
                    submitLabel="Generate"
                    busyLabel="Generating…"
                    busy={generateState === 'generating'}
                    className="generated-icon-form"
                    onChange={(value) => { setPrompt(value); setGenerateError(''); setGenerateState('idle'); }}
                    onSubmit={(event) => void generateIcon(event)}
                  />
                  {generateState === 'generating' ? <p role="status">Creating a compact emoji-style icon…</p> : null}
                  {generateState === 'error' ? <p role="alert">{generateError}</p> : null}
                  <div className="generated-icon-form-row"><ImageGrabberUploadButton label="Upload image" disabled={generateState === 'generating' || importState === 'importing'} onClick={handleUpload} /></div>
                  <ImageGrabberUrlForm
                    label="Icon image URL"
                    inputId="generated-page-icon-url"
                    value={iconUrl}
                    placeholder="https://example.com/icon.png"
                    submitLabel={importState === 'importing' ? 'Importing…' : 'Use image URL'}
                    disabled={importState === 'importing' || generateState === 'generating'}
                    className="generated-icon-form"
                    onChange={(value) => { setIconUrl(value); setImportError(''); setImportState('idle'); }}
                    onSubmit={(event) => void addIconFromUrl(event)}
                  />
                  {importState === 'importing' ? <p role="status">Downloading icon image…</p> : null}
                  {importState === 'error' ? <p role="alert">{importError}</p> : null}
                  <input ref={uploadInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void onUploadIconFile(file);
                  }} />
                </ImageGrabberPanel>
              </ImagePopupSection>
              <div className="emoji-picker-divider"><span>or pick a standard emoji</span></div>
              {loadState === 'loading' ? <div className="emoji-picker-state" role="status">Loading emojis…</div> : null}
              {loadState === 'error' ? <div className="emoji-picker-state error" role="alert"><span>Emoji picker could not load.</span><button type="button" onClick={() => { setLoadState('loading'); setLoadAttempt((attempt) => attempt + 1); }}>Retry</button></div> : null}
              <div ref={setEmojiPickerHost} className="emoji-picker-host" hidden={loadState === 'error'} />
            </>
          ) : null}
          {currentIcon || currentIconAssetId ? <div className="toolbar"><button type="button" onClick={onRemove}>Remove icon</button></div> : null}
        </div>
      )}
    />
  );
}
