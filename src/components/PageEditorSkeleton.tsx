export function PageEditorSkeleton() {
  return (
    <section className="document-shell page-editor-skeleton" role="status" aria-label="Loading page">
      <header className="document-topbar page-editor-skeleton-topbar" aria-hidden="true">
        <div className="skeleton-block skeleton-breadcrumb" />
        <div className="document-topbar-actions">
          <div className="skeleton-block skeleton-save-indicator" />
          <div className="skeleton-block skeleton-action-menu" />
        </div>
      </header>

      <div className="document-content page-editor-skeleton-content" aria-hidden="true">
        <div className="page-identity page-editor-skeleton-identity">
          <div className="page-media-affordances page-editor-skeleton-affordances">
            <div className="skeleton-block skeleton-affordance" />
            <div className="skeleton-block skeleton-affordance skeleton-affordance-wide" />
          </div>
          <div className="page-title-row">
            <div className="skeleton-block skeleton-title" />
          </div>
          <div className="skeleton-block skeleton-status" />
        </div>

        <div className="editor-view page-editor-skeleton-body">
          <div className="skeleton-block skeleton-line skeleton-line-wide" />
          <div className="skeleton-block skeleton-line skeleton-line-medium" />
          <div className="skeleton-block skeleton-line skeleton-line-wide" />
          <div className="skeleton-block skeleton-line skeleton-line-short" />
          <div className="skeleton-block skeleton-media" />
          <div className="skeleton-block skeleton-line skeleton-line-medium" />
        </div>
      </div>
    </section>
  );
}
