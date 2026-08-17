"use client";

import Image from 'next/image';
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

type AssetRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sha256: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: number;
};

type UploadTask = {
  id: string;
  file: File;
  target: 'body' | 'cover';
  status: 'uploading' | 'error';
  error?: string;
};

type RecoveryDraft = {
  pageId: string;
  title: string;
  contentJson: string;
  baseRevision: number;
  savedAt: number;
};

const DOCUMENT_FALLBACK: PartialBlock[] = [{
  type: 'paragraph',
  content: '',
}];

const ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown'];
const EMOJI_OPTIONS = ['📄', '🧾', '📚', '⚡', '✨', '🗂️', '🧠', '✍️', '🗒️', '🎯', '🛠️', '🧪', '📌', '🧭', '🔖', '🧩'];

function isSupportedUpload(file: File): boolean {
  return file.size <= 20 * 1024 * 1024 && ALLOWED_UPLOAD_TYPES.includes(file.type.toLowerCase());
}

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
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [conflictPage, setConflictPage] = useState<PageRecord | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);

  const editor = useCreateBlockNote({
    schema: PAGE_GRAPH_SCHEMA,
    trailingBlock: true,
  });

  const saveTimerRef = useRef<number | null>(null);
  const isApplyingRemoteContent = useRef(false);
  const hasPendingContent = useRef(false);
  const pendingRevision = useRef(0);
  const savedDocRef = useRef('[]');
  const titleRef = useRef('');
  const bodyUploadRef = useRef<HTMLInputElement>(null);
  const coverUploadRef = useRef<HTMLInputElement>(null);

  const draftKey = `arcane-codex:draft:${pageId}`;
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

  const readRecoveryDraft = useCallback((remote: PageRecord): RecoveryDraft | null => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return null;
      const draft = JSON.parse(raw) as Partial<RecoveryDraft>;
      if (
        draft.pageId !== pageId ||
        typeof draft.title !== 'string' ||
        typeof draft.contentJson !== 'string' ||
        typeof draft.baseRevision !== 'number' ||
        typeof draft.savedAt !== 'number'
      ) {
        window.localStorage.removeItem(draftKey);
        return null;
      }
      JSON.parse(draft.contentJson);
      if (draft.title === remote.title && draft.contentJson === remote.contentJson) {
        window.localStorage.removeItem(draftKey);
        return null;
      }
      return draft as RecoveryDraft;
    } catch {
      window.localStorage.removeItem(draftKey);
      return null;
    }
  }, [draftKey, pageId]);

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
    titleRef.current = payload.page.title;

    applyInitialContent(payload.page.contentJson);
    isApplyingRemoteContent.current = false;

    setConflictPage(null);
    setRecoveryDraft(readRecoveryDraft(payload.page));
    setStatus('idle');
    setStatusMessage('');
    setEditorReady(true);
  }, [applyInitialContent, pageId, readRecoveryDraft]);

  const loadPageList = useCallback(async () => {
    const response = await fetch('/api/pages');
    const payload = (await response.json()) as { pages: SidebarPage[] };
    setAllPages(payload.pages);
  }, []);

  const loadAssets = useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) {
      setStatus('error');
      setStatusMessage('Media library could not be loaded');
      return;
    }
    const payload = (await response.json()) as { assets: AssetRecord[] };
    setAssets(payload.assets);
  }, []);

  const savePage = useCallback(async () => {
    const documentJson = savedDocRef.current;
    const editorRevision = pendingRevision.current;

    try {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          title: titleRef.current.trim() || 'Untitled',
          contentJson: documentJson,
          revision: editorRevision,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        page?: PageRecord;
        backlinks?: PageRecord[];
        current?: PageRecord;
        error?: string;
      };

      if (response.status === 409) {
        setConflictPage(payload.current ?? null);
        setStatus('conflict');
        setStatusMessage('A newer page revision exists. Your local draft is preserved.');
        return;
      }
      if (!response.ok || !payload.page) {
        throw new Error(payload.error || 'Save request failed');
      }

      pendingRevision.current = payload.page.revision;
      setStatus('saved');
      setStatusMessage('Saved');
      setPage(payload.page);
      setBacklinks(payload.backlinks ?? []);
      setConflictPage(null);
      setRecoveryDraft(null);
      hasPendingContent.current = false;
      window.localStorage.removeItem(draftKey);

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? `${error.message}. Your draft remains in this browser.` : 'Save failed. Your draft remains in this browser.');
    }
  }, [draftKey, pageId]);

  const requestSave = useCallback(() => {
    if (!editorReady || !page || page.deletedAt) {
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }

    hasPendingContent.current = true;
    window.localStorage.setItem(draftKey, JSON.stringify({
      pageId,
      title: titleRef.current,
      contentJson: savedDocRef.current,
      baseRevision: pendingRevision.current,
      savedAt: Date.now(),
    } satisfies RecoveryDraft));
    setStatus('saving');
    setStatusMessage('Saving');

    saveTimerRef.current = window.setTimeout(() => {
      void savePage();
    }, 700);
  }, [draftKey, editorReady, page, pageId, savePage]);

  const reloadConflict = useCallback(() => {
    if (!conflictPage) return;
    pendingRevision.current = conflictPage.revision;
    titleRef.current = conflictPage.title;
    setTitle(conflictPage.title);
    setPage(conflictPage);
    applyInitialContent(conflictPage.contentJson);
    setConflictPage(null);
    setRecoveryDraft(null);
    hasPendingContent.current = false;
    window.localStorage.removeItem(draftKey);
    setStatus('saved');
    setStatusMessage('Loaded the latest saved revision');
  }, [applyInitialContent, conflictPage, draftKey]);

  const overwriteConflict = useCallback(async () => {
    if (!conflictPage) return;
    pendingRevision.current = conflictPage.revision;
    setConflictPage(null);
    setStatus('saving');
    setStatusMessage('Saving your preserved draft over the latest revision');
    await savePage();
  }, [conflictPage, savePage]);

  const restoreLocalDraft = useCallback(() => {
    if (!recoveryDraft) return;
    titleRef.current = recoveryDraft.title;
    setTitle(recoveryDraft.title);
    applyInitialContent(recoveryDraft.contentJson);
    pendingRevision.current = page?.revision ?? recoveryDraft.baseRevision;
    setRecoveryDraft(null);
    setStatus('saving');
    setStatusMessage('Recovered draft ready to save');
    window.setTimeout(requestSave, 0);
  }, [applyInitialContent, page?.revision, recoveryDraft, requestSave]);

  const discardLocalDraft = useCallback(() => {
    window.localStorage.removeItem(draftKey);
    setRecoveryDraft(null);
    setStatus('idle');
    setStatusMessage('Discarded browser recovery draft');
  }, [draftKey]);

  const updateMetadata = useCallback(async (updates: { icon?: string | null; coverAssetId?: string | null }) => {
    if (!page || page.deletedAt) {
      return;
    }

    if (hasPendingContent.current) {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      await savePage();
      if (hasPendingContent.current) {
        setStatusMessage('Resolve the editor draft before changing page media.');
        return;
      }
    }

    setStatus('saving');
    setStatusMessage('Saving page details');
    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: pendingRevision.current, ...updates }),
    });
    const payload = (await response.json().catch(() => ({}))) as { page?: PageRecord; current?: PageRecord; error?: string };

    if (response.status === 409) {
      setConflictPage(payload.current ?? null);
      setStatus('conflict');
      setStatusMessage('Page details changed elsewhere. Your editor draft is preserved.');
      return;
    }
    if (!response.ok || !payload.page) {
      setStatus('error');
      setStatusMessage(payload.error || 'Page details could not be saved');
      return;
    }

    pendingRevision.current = payload.page.revision;
    setPage(payload.page);
    setStatus('saved');
    setStatusMessage('Page details saved');
  }, [page, pageId, savePage]);

  const insertAsset = useCallback((asset: AssetRecord) => {
    const cursor = editor.getTextCursorPosition().block;
    const url = `/api/assets/${asset.id}`;
    const block = asset.mimeType.startsWith('image/')
      ? { type: 'image', props: { url, name: asset.filename, caption: asset.filename } }
      : { type: 'file', props: { url, name: asset.filename, caption: asset.filename } };
    editor.insertBlocks(
      [block] as unknown as Parameters<typeof editor.insertBlocks>[0],
      cursor,
      'after',
    );
  }, [editor]);

  const uploadAsset = useCallback(async (file: File, target: 'body' | 'cover') => {
    const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!isSupportedUpload(file)) {
      setUploadTasks((current) => [...current, { id: taskId, file, target, status: 'error', error: 'Use an image, PDF, text, or Markdown file up to 20 MB.' }]);
      return;
    }

    setUploadTasks((current) => [...current.filter((task) => task.id !== taskId), { id: taskId, file, target, status: 'uploading' }]);
    const form = new FormData();
    form.append('file', file);

    try {
      const response = await fetch('/api/assets', { method: 'POST', body: form });
      const payload = (await response.json().catch(() => ({}))) as { asset?: AssetRecord; error?: string };
      if (!response.ok || !payload.asset) {
        throw new Error(payload.error || 'Upload failed');
      }

      setAssets((current) => [payload.asset!, ...current.filter((asset) => asset.id !== payload.asset!.id)]);
      setUploadTasks((current) => current.filter((task) => task.id !== taskId));
      if (target === 'cover') {
        await updateMetadata({ coverAssetId: payload.asset.id });
      } else {
        insertAsset(payload.asset);
      }
    } catch (error) {
      setUploadTasks((current) => current.map((task) => task.id === taskId
        ? { ...task, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' }
        : task));
    }
  }, [insertAsset, updateMetadata]);

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>, target: 'body' | 'cover') => {
    const files = Array.from(event.currentTarget.files ?? []);
    for (const file of files) {
      void uploadAsset(file, target);
    }
    event.currentTarget.value = '';
  };

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

    if (page.deletedAt) {
      const restore = await fetch(`/api/pages/${pageId}/restore`, { method: 'POST' });
      if (!restore.ok) {
        setStatus('error');
        setStatusMessage('Restore failed. Run the workspace check and retry.');
        return;
      }
      await loadPage();
      setStatus('saved');
      setStatusMessage('Page restored');
      return;
    }

    const response = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
    if (!response.ok) {
      setStatus('error');
      setStatusMessage('Move to trash failed. Your page was not deleted.');
      return;
    }

    setStatus('saved');
    setStatusMessage('Moved to trash');
    await loadPage();
  };

  const onTitleInput = (event: ChangeEvent<HTMLInputElement>) => {
    titleRef.current = event.target.value;
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
    void loadAssets();

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
  }, [loadAssets, loadPage, loadPageList, savePage]);

  if (!page) {
    return <div className="editor-shell help">Loading page…</div>;
  }

  const showTrashNotice = page.deletedAt ? (
    <p className="help status-note" role="status">
      This page is in trash. Restore it before editing.
    </p>
  ) : null;
  const coverAsset = assets.find((asset) => asset.id === page.coverAssetId) ?? null;

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

      {recoveryDraft ? (
        <section className="recovery-notice" role="status">
          <strong>Unsaved browser draft found</strong>
          <span>Your saved page is intact. Restore this draft to review and save it, or discard the draft.</span>
          <div className="toolbar">
            <button type="button" onClick={restoreLocalDraft}>Restore draft</button>
            <button type="button" onClick={discardLocalDraft}>Discard draft</button>
          </div>
        </section>
      ) : null}

      {conflictPage ? (
        <section className="recovery-notice error" role="alert">
          <strong>Newer saved changes detected</strong>
          <span>Your local draft has not been overwritten. Choose which revision to keep.</span>
          <div className="toolbar">
            <button type="button" onClick={reloadConflict}>Load latest saved page</button>
            <button type="button" onClick={() => void overwriteConflict()}>Save my draft over latest</button>
          </div>
        </section>
      ) : null}

      {coverAsset ? (
        <div className="cover-preview">
          <Image
            src={`/api/assets/${coverAsset.id}`}
            alt={coverAsset.filename}
            width={1200}
            height={320}
            className="cover-preview-image"
            unoptimized
          />
        </div>
      ) : null}

      <section className="media-controls" aria-label="Page media">
        <div className="media-control-group">
          <span className="media-control-label">Icon</span>
          <div className="toolbar">
            <button
              type="button"
              className="icon-display"
              aria-haspopup="listbox"
              aria-expanded={iconPickerOpen}
              disabled={isDeleted}
              onClick={() => setIconPickerOpen((open) => !open)}
            >
              {page.icon ?? '📄'}
            </button>
            <button type="button" disabled={isDeleted || !page.icon} onClick={() => void updateMetadata({ icon: null })}>
              Remove icon
            </button>
          </div>
          {iconPickerOpen ? (
            <div className="emoji-picker" role="listbox" aria-label="Choose page icon">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={page.icon === emoji}
                  key={emoji}
                  onClick={() => {
                    setIconPickerOpen(false);
                    void updateMetadata({ icon: emoji });
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="media-control-group">
          <span className="media-control-label">Cover</span>
          <div className="toolbar">
            <button type="button" disabled={isDeleted} onClick={() => coverUploadRef.current?.click()}>
              {coverAsset ? 'Replace cover' : 'Upload cover'}
            </button>
            <button type="button" disabled={isDeleted || !coverAsset} onClick={() => void updateMetadata({ coverAssetId: null })}>
              Remove cover
            </button>
          </div>
          <input
            ref={coverUploadRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => chooseUpload(event, 'cover')}
            disabled={isDeleted}
          />
        </div>

        <div className="media-control-group">
          <span className="media-control-label">Page body</span>
          <button type="button" disabled={isDeleted} onClick={() => bodyUploadRef.current?.click()}>
            Upload attachment
          </button>
          <input
            ref={bodyUploadRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown"
            multiple
            onChange={(event) => chooseUpload(event, 'body')}
            disabled={isDeleted}
          />
        </div>
      </section>

      {uploadTasks.length ? (
        <ul className="upload-task-list" aria-label="Uploads">
          {uploadTasks.map((task) => (
            <li key={task.id} className={task.status === 'error' ? 'error' : ''}>
              <span>{task.file.name}</span>
              <span>{task.status === 'uploading' ? 'Uploading…' : task.error}</span>
              {task.status === 'error' ? (
                <div className="toolbar">
                  <button type="button" onClick={() => {
                    setUploadTasks((current) => current.filter((item) => item.id !== task.id));
                    void uploadAsset(task.file, task.target);
                  }}>
                    Retry
                  </button>
                  <button type="button" onClick={() => setUploadTasks((current) => current.filter((item) => item.id !== task.id))}>
                    Dismiss
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

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

      <section className="asset-library" aria-labelledby="asset-library-title">
        <div className="asset-library-header">
          <h3 id="asset-library-title">Media library</h3>
          <span className="help">Insert an upload or reuse it as this page’s cover.</span>
        </div>
        {assets.length ? (
          <ul>
            {assets.map((asset) => (
              <li key={asset.id}>
                <div>
                  <strong>{asset.filename}</strong>
                  <span className="help">{asset.mimeType} · {Math.max(1, Math.round(asset.size / 1024))} KB</span>
                </div>
                <div className="toolbar">
                  <button type="button" disabled={isDeleted} onClick={() => insertAsset(asset)}>Insert</button>
                  <button
                    type="button"
                    disabled={isDeleted || !asset.mimeType.startsWith('image/')}
                    onClick={() => void updateMetadata({ coverAssetId: asset.id })}
                  >
                    Use as cover
                  </button>
                  <Link className="text-link" href={`/api/assets/${asset.id}`} target="_blank" rel="noreferrer">Open</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">No media yet. Upload an attachment to add one.</p>
        )}
      </section>

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
