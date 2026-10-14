import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export type ImagePopupPage = 'info' | 'settings';

export type ImageGrabberPopupProps = {
  title: string;
  description?: string;
  className?: string;
  style?: CSSProperties;
  defaultPage?: ImagePopupPage;
  showSettings?: boolean;
  onClose?: () => void;
  rootRef?: RefObject<HTMLElement>;
  info: ReactNode;
  settings?: ReactNode;
};

export function ImageGrabberPopup({
  title,
  description,
  className = 'image-grabber-popup',
  style,
  defaultPage = 'info',
  showSettings = false,
  onClose,
  rootRef,
  info,
  settings,
}: ImageGrabberPopupProps) {
  const [page, setPage] = useState<ImagePopupPage>(defaultPage);
  const [mounted, setMounted] = useState(false);
  const activePage = showSettings ? page : 'info';

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <section ref={rootRef} className={className} style={style} aria-label={title}>
      <header className="image-grabber-popup-header">
        <div>
          <strong>{title}</strong>
          {description ? <p>{description}</p> : null}
        </div>
        {onClose ? <button type="button" className="image-grabber-popup-close" aria-label="Close image popup" onClick={onClose}>×</button> : null}
      </header>
      {showSettings ? (
        <div className="image-grabber-popup-tabs" role="tablist" aria-label="Image popup pages">
          <button type="button" role="tab" aria-selected={activePage === 'info'} className={activePage === 'info' ? 'is-active' : ''} onClick={() => setPage('info')}>Info</button>
          <button type="button" role="tab" aria-selected={activePage === 'settings'} className={activePage === 'settings' ? 'is-active' : ''} onClick={() => setPage('settings')}>Settings</button>
        </div>
      ) : null}
      <div className="image-grabber-popup-body">
        {activePage === 'settings' ? settings : info}
      </div>
    </section>,
    document.body,
  );
}

export function ImagePopupSection({ title, description, children, editorOnly = false }: { title?: string; description?: string; children: ReactNode; editorOnly?: boolean }) {
  return (
    <section className={`image-grabber-popup-section ${editorOnly ? 'is-editor-only' : ''}`}>
      {editorOnly ? <span className="image-grabber-editor-marker">Editor only</span> : null}
      {title || description ? <div>{title ? <h3>{title}</h3> : null}{description ? <p>{description}</p> : null}</div> : null}
      {children}
    </section>
  );
}
