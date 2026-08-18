export function PageEditorSkeleton() {
  return (
    <section className="editor-shell page-editor-skeleton" role="status" aria-label="Loading page">
      <div className="skeleton-block skeleton-breadcrumb" />
      <div className="skeleton-block skeleton-cover" />
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-line skeleton-line-wide" />
      <div className="skeleton-block skeleton-line skeleton-line-medium" />
      <div className="skeleton-block skeleton-line skeleton-line-short" />
    </section>
  );
}
