'use client';

import { useEffect, useRef, useState } from 'react';

type EmojiSelection = {
  native?: string;
};

type PageEmojiPickerProps = {
  currentIcon: string | null;
  onSelect: (emoji: string) => void;
  onRemove: () => void;
  onClose: (reason: 'escape' | 'outside' | 'button') => void;
};

export function PageEmojiPicker({ currentIcon, onSelect, onRemove, onClose }: PageEmojiPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);

  selectRef.current = onSelect;

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
        window.requestAnimationFrame(() => {
          (picker as unknown as HTMLElement).shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        });
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

  return (
    <div ref={rootRef} className="emoji-popover" role="dialog" aria-label="Choose page icon">
      <div className="emoji-popover-header">
        <strong>Choose an icon</strong>
        <div className="emoji-popover-actions">
          {currentIcon ? <button type="button" onClick={onRemove}>Remove</button> : null}
          <button type="button" aria-label="Close emoji picker" onClick={() => onClose('button')}>×</button>
        </div>
      </div>
      {loadState === 'loading' ? <div className="emoji-picker-state" role="status">Loading emojis…</div> : null}
      {loadState === 'error' ? (
        <div className="emoji-picker-state error" role="alert">
          <span>Emoji picker could not load.</span>
          <button type="button" onClick={() => { setLoadState('loading'); setLoadAttempt((attempt) => attempt + 1); }}>Retry</button>
        </div>
      ) : null}
      <div ref={hostRef} className="emoji-picker-host" hidden={loadState === 'error'} />
    </div>
  );
}
