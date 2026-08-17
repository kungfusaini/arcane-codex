"use client";

import Link from 'next/link';
import {
  ChangeEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BlockNoteSchema, PartialBlock } from '@blocknote/core';
import {
  BlockNoteViewRaw as BlockNoteView,
  SuggestionMenuController,
  createReactBlockSpec,
  type DefaultReactSuggestionItem,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  useEditorChange,
} from '@blocknote/react';
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import { getBreadcrumbs } from '@/lib/pageTree';

import './page-editor.css';

type PageRecord = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  coverAssetId: string | null;
  contentJson: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type SidebarPage = {
  id: string;
  parentId: string | null;
  title: string;
};

const DOCUMENT_FALLBACK: PartialBlock[] = [{
  type: 'paragraph',
  content: '',
}];

const PAGE_LINK_BLOCK = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: {
      pageId: { default: '' },
      title: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const propsByType = props.block.props as { pageId?: string; title?: string };
      const pageId = String(propsByType.pageId || '');
      const title = String(propsByType.title || 'Page');
      const href = pageId ? `/page/${pageId}` : '#';

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
          onClick={openPage}
          contentEditable={false}
          draggable={false}
          tabIndex={-1}
        >
          {title}
        </a>
      );
    },
    toExternalHTML: (props) => {
      const propsByType = props.block.props as { pageId?: string; title?: string };
      const pageId = String(propsByType.pageId || '');
      const title = String(propsByType.title || 'Page');
      return <a href={pageId ? `${pageId}.md` : '#'}>{title}</a>;
    },
  },
);

const PAGE_GRAPH_SCHEMA = BlockNoteSchema.create({
  blockSpecs: {
    pageLink: PAGE_LINK_BLOCK(),
  },
});

type MentionItem = DefaultReactSuggestionItem & {
  id: string;
  title: string;
};

export function PageEditor({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<PageRecord | null>(null);
  const [backlinks, setBacklinks] = useState<PageRecord[]>([]);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [allPages, setAllPages] = useState<SidebarPage[]>([]);
  const [editorReady, setEditorReady] = useState(false);

  const editor = useCreateBlockNote({
    schema: PAGE_GRAPH_SCHEMA,
    trailingBlock: true,
  });

  const saveTimerRef = useRef<number | null>(null);
  const isApplyingRemoteContent = useRef(false);
  const hasPendingContent = useRef(false);
  const pendingRevision = useRef(0);
  const savedDocRef = useRef('[]');
  const conflictRecovery = useRef(false);

  const normalizedTitle = useMemo(() => title.trim() || 'Untitled', [title]);
  const isDeleted = Boolean(page?.deletedAt);

  const applyInitialContent = useCallback((rawContent: string) => {
    let parsed: PartialBlock[] = DOCUMENT_FALLBACK;
    try {
      const candidate = JSON.parse(rawContent);
      if (Array.isArray(candidate)) {
        parsed = candidate as PartialBlock[];
      }
    } catch {
      parsed = DOCUMENT_FALLBACK;
    }

    const payload = parsed.length ? parsed : DOCUMENT_FALLBACK;
    isApplyingRemoteContent.current = true;
    editor.replaceBlocks(editor.document, payload as Parameters<typeof editor.replaceBlocks>[1]);
    savedDocRef.current = JSON.stringify(payload);
    isApplyingRemoteContent.current = false;
  }, [editor]);

  const refreshRevisionOnly = useCallback(async () => {
    const response = await fetch(`/api/pages/${pageId}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { page: PageRecord };
    pendingRevision.current = payload.page.revision;
  }, [pageId]);

  const loadPage = useCallback(async () => {
    const response = await fetch(`/api/pages/${pageId}`);
    if (!response.ok) {
      setStatus('error');
      setStatusMessage('Page not found');
      return;
    }

    const payload = (await response.json()) as { page: PageRecord; backlinks: PageRecord[] };
    setPage(payload.page);
    setBacklinks(payload.backlinks);
    pendingRevision.current = payload.page.revision;

    isApplyingRemoteContent.current = true;
    setTitle(payload.page.title);

    applyInitialContent(payload.page.contentJson);
    isApplyingRemoteContent.current = false;

    setStatus('idle');
    setStatusMessage('');
    setEditorReady(true);
  }, [applyInitialContent, pageId]);

  const loadPageList = useCallback(async () => {
    const response = await fetch('/api/pages');
    const payload = (await response.json()) as { pages: SidebarPage[] };
    setAllPages(payload.pages);
  }, []);

  const savePage = useCallback(async () => {
    const documentJson = savedDocRef.current;
    const editorRevision = pendingRevision.current;

    if (!editorRevision && editorRevision !== 0) {
      return;
    }

    try {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: normalizedTitle,
          contentJson: documentJson,
          revision: editorRevision,
        }),
      });

      if (response.status === 409 && !conflictRecovery.current) {
        conflictRecovery.current = true;
        setStatus('conflict');
        setStatusMessage('Revision conflict detected. Recovering…');
        await refreshRevisionOnly();
        setStatus('saving');
        setStatusMessage('Saving');
        await savePage();
        return;
      }

      if (!response.ok) {
        throw new Error('Save request failed');
      }

      const payload = (await response.json()) as { page: PageRecord; backlinks: PageRecord[] };
      pendingRevision.current = payload.page.revision;
      setStatus('saved');
      setStatusMessage('Saved');
      setPage((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          title: payload.page.title,
          contentJson: payload.page.contentJson,
          revision: payload.page.revision,
          updatedAt: payload.page.updatedAt,
        };
      });
      setBacklinks(payload.backlinks ?? []);
      hasPendingContent.current = false;
      conflictRecovery.current = false;

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    } catch {
      setStatus('error');
      setStatusMessage('Error saving page');
    }
  }, [normalizedTitle, pageId, refreshRevisionOnly]);

  const requestSave = useCallback(() => {
    if (!editorReady || !page) {
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }

    hasPendingContent.current = true;
    setStatus('saving');
    setStatusMessage('Saving');

    saveTimerRef.current = window.setTimeout(() => {
      void savePage();
    }, 700);
  }, [editorReady, page, savePage]);

  const duplicate = async () => {
    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate' }),
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { page: PageRecord };
    window.location.href = `/page/${payload.page.id}`;
  };

  const trash = async () => {
    if (!page) {
      return;
    }
    const response = await fetch(`/api/pages/${pageId}`, { method: page.deletedAt ? 'PATCH' : 'DELETE' });
    if (!response.ok) {
      setStatus('error');
      setStatusMessage(page.deletedAt ? 'Restore failed' : 'Move to trash failed');
      return;
    }

    if (page.deletedAt) {
      const restore = await fetch(`/api/pages/${pageId}/restore`, { method: 'POST' });
      if (restore.ok) {
        await loadPage();
      }
      return;
    }

    setStatus('saved');
    setStatusMessage('Moved to trash');
    await loadPage();
  };

  const onTitleInput = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
    requestSave();
  };


  const pageSuggestions = useCallback(
    (query: string): SidebarPage[] => {
      const normalized = query.trim().toLowerCase();
      const matches = allPages.filter((item) => item.id !== pageId);
      if (!normalized) {
        return matches.slice(0, 6);
      }

      return matches.filter((item) => item.title.toLowerCase().includes(normalized)).slice(0, 6);
    },
    [allPages, pageId],
  );

  const insertPageCard = useCallback((targetPage: SidebarPage) => {
    insertOrUpdateBlockForSlashMenu(editor, {
      type: 'pageLink',
      props: {
        pageId: targetPage.id,
        title: targetPage.title || 'Untitled',
      },
    });
  }, [editor]);

  const getSlashMenuItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & { pageId?: string })[]> => {
    const defaultItems = filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query);
    const pages = pageSuggestions(query).map((item) => ({
      title: `Page: ${item.title || 'Untitled'}`,
      subtext: 'Insert page card',
      onItemClick: () => {
        insertPageCard(item);
      },
      pageId: item.id,
      group: 'Pages',
    }));

    return [...defaultItems, ...pages];
  }, [editor, insertPageCard, pageSuggestions]);

  const insertMention = useCallback(
    (item: MentionItem) => {
      editor.insertInlineContent({
        type: 'link',
        href: `/page/${item.id}`,
        content: item.title,
      } as unknown as Parameters<typeof editor.insertInlineContent>[0]);
    },
    [editor],
  );

  const getMentionItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & MentionItem)[]> => {
    return pageSuggestions(query).map((candidate) => {
      const title = candidate.title || 'Untitled';
      return {
        title,
        subtext: 'Link this page',
        id: candidate.id,
        onItemClick: () => {
          insertMention({
            id: candidate.id,
            title,
          } as MentionItem);
        },
      };
    });
  }, [insertMention, pageSuggestions]);

  useEditorChange(() => {
    if (!editorReady || isApplyingRemoteContent.current) {
      return;
    }

    const documentJson = JSON.stringify(editor.document);
    savedDocRef.current = documentJson;
    requestSave();
  }, editor);

  const breadcrumbs = useMemo(() => {
    type BreadcrumbEntry = {
      id: string;
      parentId: string | null;
      title: string;
      icon: string | null;
      sortKey: number;
    };
    const breadcrumbMap = new Map<string, BreadcrumbEntry>(
      allPages.map((item) => [
        item.id,
        {
          id: item.id,
          parentId: item.parentId,
          title: item.title,
          icon: null,
          sortKey: 0,
        },
      ]),
    );
    return getBreadcrumbs(breadcrumbMap as unknown as Map<string, BreadcrumbEntry>, pageId);
  }, [allPages, pageId]);

  useEffect(() => {
    void loadPage();
    void loadPageList();

    const unload = () => {
      if (hasPendingContent.current) {
        clearTimeout(saveTimerRef.current ?? undefined);
        void savePage();
      }
    };

    window.addEventListener('beforeunload', unload);

    return () => {
      window.removeEventListener('beforeunload', unload);
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [loadPage, loadPageList, savePage]);

  if (!page) {
    return <div className="editor-shell help">Loading page…</div>;
  }

  const showTrashNotice = page.deletedAt ? (
    <p className="help status-note" role="status">
      This page is in trash. Restore it before editing.
    </p>
  ) : null;

  return (
    <section className="editor-shell" aria-live="polite">
      <div className="editor-toolbar">
        <div>
          <div className="help">
            {breadcrumbs.length > 0 ? (
              breadcrumbs.map((crumb, index) => (
                <span key={crumb.id}>
                  <Link className="text-link" href={`/page/${crumb.id}`}>
                    {crumb.title}
                  </Link>
                  {index + 1 < breadcrumbs.length ? ' / ' : ''}
                </span>
              ))
            ) : null}
          </div>
          <input
            className="page-title"
            value={title}
            onChange={onTitleInput}
            placeholder="Page title"
            disabled={isDeleted}
          />
        </div>

        <div className="toolbar">
          <button type="button" onClick={duplicate} disabled={isDeleted}>
            Duplicate
          </button>
          <button type="button" onClick={trash}>
            {page.deletedAt ? 'Restore' : 'Move to trash'}
          </button>
          <button type="button" onClick={() => {
            editor.undo();
          }} disabled={isDeleted}>
            Undo
          </button>
          <button type="button" onClick={() => {
            editor.redo();
          }} disabled={isDeleted}>
            Redo
          </button>
        </div>
      </div>

      {showTrashNotice}

      <div className={`status ${status === 'idle' ? '' : status === 'saved' ? 'saved' : status === 'error' ? 'error' : status === 'conflict' ? 'error' : 'saving'}`}>
        {statusMessage || 'Saved'}
      </div>

      <div className="editor-view">
        <BlockNoteView
          editor={editor}
          slashMenu={false}
          editable={!isDeleted}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getSlashMenuItems}
          />
          <SuggestionMenuController
            triggerCharacter="@"
            minQueryLength={1}
            getItems={getMentionItems}
            onItemClick={(item) => {
              insertMention(item as MentionItem);
            }}
          />
        </BlockNoteView>
      </div>

      <section className="backlinks">
        <h3>Backlinks</h3>
        {backlinks.length ? (
          <ul>
            {backlinks.map((link) => (
              <li key={link.id}>
                <Link href={`/page/${link.id}`} className="text-link">
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">No inbound links yet.</p>
        )}
      </section>
    </section>
  );
}
