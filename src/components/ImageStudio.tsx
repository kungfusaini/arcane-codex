"use client";

import { ChangeEvent, useRef, useState } from 'react';
import '@/app/image-studio.css';

const DEMO_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg';

export function ImageStudio() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(DEMO_IMAGE);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice('');
    setImage(URL.createObjectURL(file));
  };

  const editImage = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, prompt: prompt.trim() }),
      });
      const payload = await response.json() as { image?: string; error?: string };
      if (!response.ok || !payload.image) throw new Error(payload.error || 'The edit could not be completed.');
      setImage(payload.image);
      setPrompt('');
      setNotice('Edit applied. Only the requested change was sent to Codex Imagegen.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The edit could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="image-studio">
      <header className="studio-header">
        <div className="studio-brand"><span className="brand-mark">✦</span><span>Codex Image Studio</span></div>
        <div className="studio-header-actions"><span className="local-status"><i /> Local workspace</span><button className="ghost-btn" type="button" onClick={() => fileInput.current?.click()}>Open image</button></div>
      </header>

      <section className="studio-content">
        <div className="studio-intro"><p className="eyebrow">Focused edit</p><h1>Change one thing.</h1><p>Upload an image, click what you want to change, and describe it. Everything else stays as-is.</p></div>
        <div className="editor-grid">
          <section className="canvas-panel" aria-label="Image preview">
            <div className="canvas-toolbar"><span className="toolbar-file"><span className="file-icon">▧</span> {image === DEMO_IMAGE ? 'mona-lisa.jpg' : 'uploaded-image'}</span><span className="toolbar-meta">Click image to edit</span></div>
            <button className="image-stage" type="button" onClick={() => document.getElementById('prompt')?.focus()} aria-label="Select image and focus edit prompt">
              <img src={image} alt="Mona Lisa preview" />
              <span className="edit-hint"><span>＋</span> Add an edit prompt</span>
            </button>
            <div className="canvas-footer"><span>Original composition protected</span><span className="lock">⌁</span></div>
          </section>

          <aside className="prompt-panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>Describe the change</h2><p>Keep it specific. We preserve the rest.</p></div></div>
            <label htmlFor="prompt">Edit prompt</label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. Make her look sad" rows={5} disabled={busy} />
            <div className="prompt-guidance"><span>✦</span><p><strong>Protected by default</strong><br />Subject, framing, lighting, background, and details stay unchanged.</p></div>
            <button className="apply-btn" type="button" onClick={editImage} disabled={!prompt.trim() || busy}>{busy ? 'Applying edit…' : 'Apply edit'}<span aria-hidden="true">↗</span></button>
            {notice && <p className={notice.startsWith('Edit applied') ? 'notice success' : 'notice error'} role={notice.startsWith('Edit applied') ? 'status' : 'alert'}>{notice}</p>}
            <button className="upload-link" type="button" onClick={() => fileInput.current?.click()}>＋ Choose a different image</button>
          </aside>
        </div>
        <div className="studio-note"><span>⌘</span> Powered by Codex Imagegen <span className="dot">·</span> edits run locally from this browser</div>
      </section>
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />
    </main>
  );
}

export default ImageStudio;
