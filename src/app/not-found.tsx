import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found-shell">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <p className="eyebrow">Missing page</p>
        <h1 id="not-found-title">This codex entry does not exist.</h1>
        <p className="help">The requested workspace path could not be found. Return home or create a page with this slug.</p>
        <div className="toolbar">
          <Link className="primary-btn not-found-action" href="/">Return to workspace</Link>
        </div>
      </section>
    </main>
  );
}
