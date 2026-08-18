"use client";

import Image from 'next/image';
import Link from 'next/link';
import {
  ChangeEvent,
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { BlockNoteSchema, PartialBlock, defaultBlockSpecs } from '@blocknote/core';
import {
  BlockNoteViewRaw as BlockNoteView,
  SuggestionMenuController,
  createReactBlockSpec,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  useEditorChange,
} from '@blocknote/react';
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import { getBreadcrumbs } from '@/lib/pageTree';
import { PageEmojiPicker } from '@/components/PageEmojiPicker';
import { useDismissibleDetails } from '@/components/useDismissibleDetails';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';

import './page-editor.css';

type PageRecord = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  coverAssetId: string | null;
  coverFocalX: number;
  coverFocalY: number;
  coverScale: number;
  contentJson: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type SidebarPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
};

const COVER_FOCAL_STEP = 5;
const COVER_SCALE_STEP = 5;

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
  blockId?: string;
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

function isSupportedUpload(file: File): boolean {
  return file.size <= 20 * 1024 * 1024 && ALLOWED_UPLOAD_TYPES.includes(file.type.toLowerCase());
}

function getPastedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function getUrlTitle(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

type ReferencedPage = {
  title: string;
  icon: string | null;
};

function createPageLinkBlockSpec(referencedPages: Map<string, ReferencedPage>) {
  return createReactBlockSpec(
    {
      type: 'pageLink',
      propSchema: {
        pageId: { default: '' },
        title: { default: '' },
        icon: { default: '' },
        url: { default: '' },
      },
      content: 'none',
    },
    {
      render: (props) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const reference = pageId
          ? referencedPages.get(pageId) ?? { title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null }
          : { title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null };
        const label = `${reference.icon ? `${reference.icon} ` : ''}${reference.title || String(propsByType.title || 'Page')}`;
        const href = externalUrl || (pageId ? `/page/${pageId}` : '#');

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
            aria-label={`Open ${label}`}
            onClick={openPage}
            target={externalUrl ? '_blank' : undefined}
            rel={externalUrl ? 'noreferrer' : undefined}
            contentEditable={false}
            draggable={false}
          >
            <span className="page-link-icon" aria-hidden="true">{reference.icon || '📄'}</span>
            <span className="page-link-title">{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
      toExternalHTML: (props) => {
        const propsByType = props.block.props as { pageId?: string; title?: string; icon?: string; url?: string };
        const pageId = String(propsByType.pageId || '');
        const externalUrl = String(propsByType.url || '');
        const reference = pageId
          ? referencedPages.get(pageId) ?? { title: propsByType.icon ? String(propsByType.title || 'Page').replace(/^\S+\s/, '') : String(propsByType.title || 'Page'), icon: propsByType.icon || null }
          : { title: propsByType.title || (externalUrl ? getUrlTitle(externalUrl) : 'Page'), icon: propsByType.icon || null };
        return (
          <a href={externalUrl || (pageId ? `/page/${pageId}` : '#')} target={externalUrl ? '_blank' : undefined} rel={externalUrl ? 'noreferrer' : undefined}>
            <span aria-hidden="true">{reference.icon || '📄'}</span>
            <span>{reference.title || String(propsByType.title || 'Page')}</span>
          </a>
        );
      },
    },
  );
}

type MentionItem = DefaultReactSuggestionItem & {
  id: string;
  title: string;
  icon?: ReactElement;
  label: string;
};

function ArcaneSuggestionMenu<T extends DefaultReactSuggestionItem>({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<T>) {
  let activeGroup: string | undefined;

  return (
    <div id="bn-suggestion-menu" className="arcane-suggestion-menu" role="listbox" aria-label="Editor suggestions">
      {items.map((item, index) => {
        const groupChanged = item.group !== activeGroup;
        activeGroup = item.group;

        return (
          <div className="arcane-suggestion-entry" key={`${item.title}-${index}`}>
            {groupChanged && item.group ? <div className="arcane-suggestion-group">{item.group}</div> : null}
            <button
              id={`bn-suggestion-menu-item-${index}`}
              className={`arcane-suggestion-item ${item.icon ? '' : 'without-icon'}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onItemClick?.(item)}
            >
              {item.icon ? <span className="arcane-suggestion-icon" aria-hidden="true">{item.icon}</span> : null}
              <span className="arcane-suggestion-copy">
                <strong>{item.title}</strong>
                {item.subtext ? <span>{item.subtext}</span> : null}
              </span>
            </button>
          </div>
        );
      })}
      {items.length === 0 && loadingState === 'loaded' ? (
        <div className="arcane-suggestion-empty">No matching suggestions</div>
      ) : null}
      {loadingState === 'loading' || loadingState === 'loading-initial' ? (
        <div className="arcane-suggestion-loading" role="status">Loading suggestions…</div>
      ) : null}
    </div>
  );
}

export function PageEditor({ pageId }: { pageId: string }) {
  useDismissibleDetails('.action-menu');

  const [page, setPage] = useState<PageRecord | null>(null);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [allPages, setAllPages] = useState<SidebarPage[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [coverUrlOpen, setCoverUrlOpen] = useState(false);
  const [coverUrl, setCoverUrl] = useState('');
  const [imageUrlOpen, setImageUrlOpen] = useState(false);
  const [imageUrlPosition, setImageUrlPosition] = useState<{ top: number; left: number } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageHover, setImageHover] = useState<{ blockId: string; top: number; left: number; caption: string } | null>(null);
  const [captionEditor, setCaptionEditor] = useState<{ blockId: string; top: number; left: number; value: string } | null>(null);
  const [conflictPage, setConflictPage] = useState<PageRecord | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const [coverDraft, setCoverDraft] = useState<{ x: number; y: number; scale: number } | null>(null);

  const referencedPages = useMemo(() => {
    const map = new Map<string, ReferencedPage>();
    for (const item of allPages) {
      map.set(item.id, { title: item.title || 'Untitled', icon: item.icon ?? null });
    }
    return map;
  }, [allPages]);

  const setUploadTask = useCallback((taskId: string, patch: Partial<UploadTask>) => {
    setUploadTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        return { ...task, ...patch };
      }),
    );
  }, []);

  const addUploadTask = useCallback((task: Omit<UploadTask, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setUploadTasks((current) => [...current, { ...task, id }]);
    return id;
  }, []);

  const removeUploadTask = useCallback((taskId: string) => {
    setUploadTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const importAssetFromUrl = useCallback(async (url: string): Promise<AssetRecord> => {
    const response = await fetch('/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = (await response.json().catch(() => ({}))) as { asset?: AssetRecord; error?: string };
    if (!response.ok || !payload.asset) {
      throw new Error(payload.error || 'Image import failed');
    }
    setAssets((current) => [payload.asset!, ...current.filter((existing) => existing.id !== payload.asset!.id)]);
    return payload.asset;
  }, []);

  const uploadAssetRecord = useCallback(async (file: File): Promise<AssetRecord> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/assets', { method: 'POST', body: form });
    const payload = (await response.json().catch(() => ({}))) as { asset?: AssetRecord; error?: string };
    if (!response.ok || !payload.asset) {
      throw new Error(payload.error || 'Upload failed');
    }
    const asset = payload.asset;
    setAssets((current) => [asset, ...current.filter((existing) => existing.id !== asset.id)]);
    return asset;
  }, []);

  const editor = useCreateBlockNote({
    schema: useMemo(
      () =>
        BlockNoteSchema.create({
          blockSpecs: {
            ...defaultBlockSpecs,
            pageLink: createPageLinkBlockSpec(referencedPages)(),
          },
        }),
      [referencedPages],
    ),
    trailingBlock: true,
    uploadFile: async (file, blockId) => {
      const taskId = addUploadTask({
        file,
        target: 'body',
        status: 'uploading',
        ...(blockId ? { blockId } : {}),
      });
      try {
        if (!isSupportedUpload(file)) {
          throw new Error('Use an image, PDF, text, or Markdown file up to 20 MB.');
        }
        const asset = await uploadAssetRecord(file);
        removeUploadTask(taskId);
        return {
          props: {
            url: `/api/assets/${asset.id}`,
            name: asset.filename,
            caption: '',
          },
        };
      } catch (error) {
        setUploadTask(taskId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
        throw error;
      }
    },
  });

  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveQueuedRef = useRef(false);
  const savePageRef = useRef<() => Promise<void>>(async () => {});
  const editVersionRef = useRef(0);
  const isApplyingRemoteContent = useRef(false);
  const hasPendingContent = useRef(false);
  const pendingRevision = useRef(0);
  const savedDocRef = useRef('[]');
  const titleRef = useRef('');
  const bodyUploadRef = useRef<HTMLInputElement>(null);
  const coverUploadRef = useRef<HTMLInputElement>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreIconFocusRef = useRef(false);
  const coverDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);

  const draftKey = `arcane-codex:draft:${pageId}`;
  const isDeleted = Boolean(page?.deletedAt);

  const coverPositionPercent = useMemo(() => page?.coverAssetId
    ? {
        x: Number.isFinite(page.coverFocalX) ? Math.round(page.coverFocalX / COVER_FOCAL_STEP) * COVER_FOCAL_STEP : 50,
        y: Number.isFinite(page.coverFocalY) ? Math.round(page.coverFocalY / COVER_FOCAL_STEP) * COVER_FOCAL_STEP : 50,
        scale: Number.isFinite(page.coverScale) ? Math.round(page.coverScale / COVER_SCALE_STEP) * COVER_SCALE_STEP : 100,
      }
    : null, [page?.coverAssetId, page?.coverFocalX, page?.coverFocalY, page?.coverScale]);

  const displayedCoverPosition = coverDraft ?? coverPositionPercent;

  const clampCoverScale = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return 100;
    }
    if (value <= 100) {
      return 100;
    }
    if (value >= 200) {
      return 200;
    }
    return Math.round(value / COVER_SCALE_STEP) * COVER_SCALE_STEP;
  }, []);

  const clampCoverFocal = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return 50;
    }
    if (value <= 0) {
      return 0;
    }
    if (value >= 100) {
      return 100;
    }
    return Math.round(value / COVER_FOCAL_STEP) * COVER_FOCAL_STEP;
  }, []);

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
    queueMicrotask(() => {
      isApplyingRemoteContent.current = false;
    });
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
    setStatus('idle');
    setStatusMessage('');
    try {
      const response = await fetch(`/api/pages/${pageId}`);
      if (!response.ok) {
        throw new Error(response.status === 404 ? 'Page not found' : 'Page could not be loaded');
      }

      const payload = (await response.json()) as { page: PageRecord };
      setPage(payload.page);
      pendingRevision.current = payload.page.revision;
      editVersionRef.current = 0;
      saveQueuedRef.current = false;
      hasPendingContent.current = false;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      setTitle(payload.page.title);
      titleRef.current = payload.page.title;

      applyInitialContent(payload.page.contentJson);

      setConflictPage(null);
      setRecoveryDraft(readRecoveryDraft(payload.page));
      setStatus('idle');
      setStatusMessage('');
      setShowLoadingSkeleton(false);
      if (loadingTimerRef.current !== null) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setEditorReady(true);
    } catch (error) {
      setPage(null);
      setEditorReady(false);
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Page could not be loaded');
    }
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
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      await saveInFlightRef.current;
      return;
    }

    saveQueuedRef.current = false;
    const documentJson = savedDocRef.current;
    const titleToSave = titleRef.current.trim() || 'Untitled';
    const editorRevision = pendingRevision.current;
    const saveVersion = editVersionRef.current;

    let canFlushQueuedSave = false;
    const operation = (async () => {
      try {
        const response = await fetch(`/api/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            title: titleToSave,
            contentJson: documentJson,
            revision: editorRevision,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          page?: PageRecord;
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

        canFlushQueuedSave = true;
        pendingRevision.current = payload.page.revision;
        setPage(payload.page);
        setConflictPage(null);
        setRecoveryDraft(null);
        window.dispatchEvent(new Event('arcane-pages-changed'));

        if (editVersionRef.current === saveVersion) {
          setStatus('saved');
          setStatusMessage('Saved');
          hasPendingContent.current = false;
          window.localStorage.removeItem(draftKey);
        } else {
          saveQueuedRef.current = true;
          hasPendingContent.current = true;
          setStatus('saving');
          setStatusMessage('Saving newer changes');
        }
      } catch (error) {
        setStatus('error');
        setStatusMessage(error instanceof Error ? `${error.message}. Your draft remains in this browser.` : 'Save failed. Your draft remains in this browser.');
      }
    })();

    saveInFlightRef.current = operation;
    try {
      await operation;
    } finally {
      saveInFlightRef.current = null;
      if (canFlushQueuedSave && saveQueuedRef.current && hasPendingContent.current) {
        saveQueuedRef.current = false;
        window.setTimeout(() => {
          void savePageRef.current();
        }, 0);
      }
    }
  }, [draftKey, pageId]);

  savePageRef.current = savePage;

  const requestSave = useCallback(() => {
    if (!editorReady || !page || page.deletedAt) {
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }

    editVersionRef.current += 1;
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
      saveTimerRef.current = null;
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

  const updateMetadata = useCallback(async (updates: { icon?: string | null; coverAssetId?: string | null; coverFocalX?: number; coverFocalY?: number; coverScale?: number }) => {
    if (!page || page.deletedAt) {
      return false;
    }

    if (hasPendingContent.current) {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      await savePage();
      if (hasPendingContent.current) {
        setStatusMessage('Resolve the editor draft before changing page media.');
        return false;
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
      return false;
    }
    if (!response.ok || !payload.page) {
      setStatus('error');
      setStatusMessage(payload.error || 'Page details could not be saved');
      return false;
    }

    pendingRevision.current = payload.page.revision;
    setPage(payload.page);
    window.dispatchEvent(new Event('arcane-pages-changed'));
    setStatus('saved');
    setStatusMessage('Page details saved');
    return true;
  }, [page, pageId, savePage]);

  const setIconTrigger = useCallback((node: HTMLButtonElement | null) => {
    iconTriggerRef.current = node;
    if (node && restoreIconFocusRef.current) {
      restoreIconFocusRef.current = false;
      node.focus();
    }
  }, []);

  const closeIconPicker = useCallback((reason: 'escape' | 'outside' | 'button') => {
    setIconPickerOpen(false);
    if (reason !== 'outside') {
      window.requestAnimationFrame(() => iconTriggerRef.current?.focus());
    }
  }, []);

  const selectPageIcon = useCallback((emoji: string) => {
    restoreIconFocusRef.current = true;
    setIconPickerOpen(false);
    void updateMetadata({ icon: emoji });
  }, [updateMetadata]);

  const removePageIcon = useCallback(() => {
    restoreIconFocusRef.current = true;
    setIconPickerOpen(false);
    void updateMetadata({ icon: null });
  }, [updateMetadata]);

  const updateCoverScale = useCallback((value: number) => {
    setCoverDraft((current) => {
      const base = current ?? coverPositionPercent;
      return base ? { ...base, scale: clampCoverScale(value) } : current;
    });
  }, [clampCoverScale, coverPositionPercent]);

  const beginCoverReposition = useCallback(() => {
    if (coverPositionPercent) {
      setCoverDraft(coverPositionPercent);
    }
  }, [coverPositionPercent]);

  const onCoverPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!coverDraft || (event.target as HTMLElement).closest('.cover-reposition-toolbar')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    coverDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: coverDraft.x,
      y: coverDraft.y,
    };
  }, [coverDraft]);

  const onCoverPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = coverDragRef.current;
    if (!drag || !coverDraft || drag.pointerId !== event.pointerId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextX = drag.x - ((event.clientX - drag.clientX) / Math.max(bounds.width, 1)) * 100;
    const nextY = drag.y - ((event.clientY - drag.clientY) / Math.max(bounds.height, 1)) * 100;
    setCoverDraft({ x: clampCoverFocal(nextX), y: clampCoverFocal(nextY), scale: coverDraft.scale });
  }, [clampCoverFocal, coverDraft]);

  const finishCoverPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (coverDragRef.current?.pointerId === event.pointerId) {
      coverDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const saveCoverPosition = useCallback(async () => {
    if (!coverDraft) {
      return;
    }
    const saved = await updateMetadata({ coverFocalX: coverDraft.x, coverFocalY: coverDraft.y, coverScale: coverDraft.scale });
    if (saved) {
      setCoverDraft(null);
    }
  }, [coverDraft, updateMetadata]);

  const insertAsset = useCallback((asset: AssetRecord, blockId?: string) => {
    const url = `/api/assets/${asset.id}`;
    const block = asset.mimeType.startsWith('image/')
      ? { type: 'image', props: { url, name: asset.filename, caption: '' } }
      : { type: 'file', props: { url, name: asset.filename, caption: asset.filename } };

    if (blockId) {
      try {
        editor.updateBlock(blockId, block as Parameters<typeof editor.updateBlock>[1]);
      } catch {
        const cursor = editor.getTextCursorPosition().block;
        editor.insertBlocks(
          [block] as unknown as Parameters<typeof editor.insertBlocks>[0],
          cursor,
          'after',
        );
      }
      return;
    }

    const cursor = editor.getTextCursorPosition().block;
    editor.insertBlocks(
      [block] as unknown as Parameters<typeof editor.insertBlocks>[0],
      cursor,
      'after',
    );
  }, [editor]);

  const uploadForBody = useCallback(async (file: File, taskId: string, blockId?: string) => {
    const asset = await uploadAssetRecord(file);
    insertAsset(asset, blockId);
    removeUploadTask(taskId);
    return asset;
  }, [insertAsset, removeUploadTask, uploadAssetRecord]);

  const uploadForCover = useCallback(async (file: File, taskId: string) => {
    const asset = await uploadAssetRecord(file);
    await updateMetadata({ coverAssetId: asset.id });
    removeUploadTask(taskId);
    return asset;
  }, [removeUploadTask, updateMetadata, uploadAssetRecord]);

  const uploadAndHandleTask = useCallback(async (file: File, target: 'body' | 'cover', blockId?: string) => {
    if (!isSupportedUpload(file)) {
      setUploadTasks((current) => [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, file, target, status: 'error', error: 'Use an image, PDF, text, or Markdown file up to 20 MB.' }]);
      return;
    }

    const taskId = addUploadTask({
      file,
      target,
      status: 'uploading',
      ...(blockId ? { blockId } : {}),
    });

    try {
      if (target === 'cover') {
        await uploadForCover(file, taskId);
        return;
      }
      await uploadForBody(file, taskId);
    } catch (error) {
      setUploadTask(taskId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  }, [addUploadTask, setUploadTask, uploadForBody, uploadForCover]);

  const retryUploadTask = useCallback((task: UploadTask) => {
    setUploadTasks((current) => current.filter((item) => item.id !== task.id));
    void uploadAndHandleTask(task.file, task.target, task.blockId);
  }, [uploadAndHandleTask]);

  const addCoverFromUrl = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = getPastedUrl(coverUrl);
    if (!url) {
      setStatus('error');
      setStatusMessage('Enter a valid HTTP(S) image URL.');
      return;
    }
    try {
      const asset = await importAssetFromUrl(url);
      await updateMetadata({ coverAssetId: asset.id });
      setCoverUrl('');
      setCoverUrlOpen(false);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Image import failed');
    }
  }, [coverUrl, importAssetFromUrl, updateMetadata]);

  const addImageFromUrl = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = getPastedUrl(imageUrl);
    if (!url) {
      setStatus('error');
      setStatusMessage('Enter a valid HTTP(S) image URL.');
      return;
    }
    try {
      const asset = await importAssetFromUrl(url);
      insertAsset(asset);
      setImageUrl('');
      setImageUrlOpen(false);
      setImageUrlPosition(null);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Image import failed');
    }
  }, [imageUrl, importAssetFromUrl, insertAsset]);

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>, target: 'body' | 'cover') => {
    if (target === 'body') {
      setImageUrlOpen(false);
      setImageUrlPosition(null);
    }
    const files = Array.from(event.currentTarget.files ?? []);
    for (const file of files) {
      void uploadAndHandleTask(file, target);
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
      window.dispatchEvent(new Event('arcane-pages-changed'));
      setStatus('saved');
      setStatusMessage('Page restored');
      return;
    }

    if (!window.confirm(`Move “${page.title || 'Untitled'}” to trash? You can restore it from the sidebar.`)) {
      return;
    }

    if (hasPendingContent.current) {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await savePage();
      if (hasPendingContent.current) {
        setStatus('error');
        setStatusMessage('Save or resolve the current draft before moving this page to trash.');
        return;
      }
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
    window.dispatchEvent(new Event('arcane-pages-changed'));
  };

  const onTitleInput = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    titleRef.current = event.target.value;
    setTitle(event.target.value);
    requestSave();
  };

  const pagesById = useMemo(
    () => new Map(allPages.map((item) => [item.id, item])),
    [allPages],
  );

  const labelForPage = useCallback((pageId: string) => {
    const pageInfo = pagesById.get(pageId);
    const title = pageInfo?.title || 'Page';
    return {
      title,
      icon: pageInfo?.icon ?? null,
      label: `${pageInfo?.icon ? `${pageInfo.icon} ` : ''}${title}`,
    };
  }, [pagesById]);

  const getPageIdFromHref = useCallback((href: string) => {
    try {
      const normalized = decodeURIComponent(href).trim();
      const result = /^(?:https?:\/\/[^\/]+)?\/?page\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        normalized,
      );
      if (result?.[1]) {
        return result[1];
      }
    } catch {
      return null;
    }
    return null;
  }, []);

  const refreshLiveReferenceLabels = useCallback(() => {
    const blocks = JSON.parse(JSON.stringify(editor.document)) as Array<Record<string, unknown>>;
    let updated = false;

    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          visit(child);
        }
        return;
      }

      const block = node as Record<string, unknown>;
      if (block.type === 'pageLink' && block.props && typeof block.props === 'object') {
        const blockProps = block.props as Record<string, unknown>;
        const pageId = String(blockProps.pageId || '').trim();
        if (pageId) {
          const { title, label, icon } = labelForPage(pageId);
          const currentTitle = String(blockProps.title || '');
          if (currentTitle !== title) {
            block.props = {
              ...blockProps,
              title,
              label,
              icon: icon ?? null,
            };
            updated = true;
          }
        }
        return;
      }

      if (block.type === 'link' && typeof block.href === 'string') {
        const targetId = getPageIdFromHref(block.href);
        if (targetId) {
          const { label } = labelForPage(targetId);
          const firstContent = Array.isArray(block.content) ? block.content[0] : undefined;
          const current = typeof firstContent === 'object' && firstContent !== null && 'text' in firstContent
            ? String((firstContent as { text?: unknown }).text || '')
            : '';
          if (current !== label) {
            const firstStyles = typeof firstContent === 'object' && firstContent !== null && 'styles' in firstContent
              ? (firstContent as { styles?: unknown }).styles
              : {};
            block.content = [{
              type: 'text',
              text: label,
              styles: firstStyles,
            }];
            updated = true;
          }
        }
      }

      const content = block.content;
      if (Array.isArray(content)) {
        visit(content);
      }
      for (const value of Object.values(block)) {
        if (Array.isArray(value)) {
          visit(value);
        } else if (value && typeof value === 'object') {
          visit(value);
        }
      }
    };

    visit(blocks);
    if (updated) {
      isApplyingRemoteContent.current = true;
      editor.replaceBlocks(editor.document, blocks);
      queueMicrotask(() => {
        isApplyingRemoteContent.current = false;
      });
    }
  }, [editor, getPageIdFromHref, labelForPage]);

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
    const label = labelForPage(targetPage.id).label;
    insertOrUpdateBlockForSlashMenu(editor, {
      type: 'pageLink',
      props: {
        pageId: targetPage.id,
        title: label,
        icon: targetPage.icon ?? '',
      },
    });
  }, [editor, labelForPage]);

  const createChildPageCard = useCallback(async () => {
    const response = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', parentId: pageId }),
    });
    const payload = (await response.json().catch(() => ({}))) as { page?: SidebarPage; error?: string };
    if (!response.ok || !payload.page) {
      setStatus('error');
      setStatusMessage(payload.error || 'Child page could not be created');
      return;
    }

    setAllPages((current) => [...current.filter((item) => item.id !== payload.page!.id), payload.page!]);
    insertPageCard(payload.page);
    window.dispatchEvent(new Event('arcane-pages-changed'));
    setStatus('saving');
    setStatusMessage('Child page created; saving page card');
  }, [insertPageCard, pageId]);

  const openImageUrlPicker = useCallback(() => {
    const selection = editor.getSelectionBoundingBox();
    setImageUrlPosition(selection ? {
      top: Math.min(selection.bottom + 8, window.innerHeight - 180),
      left: Math.min(selection.left, window.innerWidth - 460),
    } : null);
    setImageUrlOpen(true);
  }, [editor]);

  const getSlashMenuItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & { pageId?: string })[]> => {
    const defaultItems = filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query).map((item) => (item as DefaultReactSuggestionItem & { key?: string }).key === 'image'
      ? { ...item, onItemClick: openImageUrlPicker }
      : item);
    const normalized = query.trim().toLowerCase();
    const createChildItem = !normalized || 'new child page'.includes(normalized)
      ? [{
          title: 'New child page',
          subtext: 'Create a nested page and insert its page card',
          onItemClick: () => {
            void createChildPageCard();
          },
          group: 'Pages',
        }]
      : [];
    const imageUrlItem = !normalized || 'image from url'.includes(normalized)
      ? [{
          title: 'Image from URL',
          subtext: 'Download an image into the media library',
          onItemClick: openImageUrlPicker,
          group: 'Media',
        }]
      : [];
    const pages = pageSuggestions(query).map((item) => ({
      title: item.title || 'Untitled',
      subtext: 'Insert page card',
      icon: <span aria-hidden="true">{item.icon || '📄'}</span>,
      onItemClick: () => {
        insertPageCard(item);
      },
      pageId: item.id,
      group: 'Pages',
    }));

    return [...defaultItems, ...imageUrlItem, ...createChildItem, ...pages];
  }, [createChildPageCard, editor, insertPageCard, openImageUrlPicker, pageSuggestions]);

  const insertMention = useCallback(
    (item: MentionItem) => {
      editor.insertInlineContent([{
        type: 'link',
        href: `/page/${item.id}`,
        content: item.label,
      }]);
    },
    [editor],
  );

  const getMentionItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & MentionItem)[]> => {
    return pageSuggestions(query).map((candidate) => {
      const title = candidate.title || 'Untitled';
      const label = labelForPage(candidate.id).label;
      const icon = candidate.icon ? <span>{candidate.icon}</span> : undefined;
      return {
        title,
        label,
        icon,
        subtext: 'Link this page',
        id: candidate.id,
        onItemClick: () => {
          insertMention({
            id: candidate.id,
            title,
            label,
            icon,
          } as MentionItem);
        },
      };
    });
  }, [insertMention, labelForPage, pageSuggestions]);

  useEffect(() => {
    if (!editorReady) {
      return;
    }
    refreshLiveReferenceLabels();
  }, [editorReady, allPages, refreshLiveReferenceLabels]);

  useEditorChange(() => {
    if (!editorReady || isApplyingRemoteContent.current) {
      return;
    }

    const documentJson = JSON.stringify(editor.document);
    savedDocRef.current = documentJson;
    requestSave();
  }, editor);

  const enterEditing = useCallback(() => {
    if (isDeleted) {
      return;
    }
    setIsEditing(true);
    window.requestAnimationFrame(() => editor.focus());
  }, [editor, isDeleted]);

  const onEditorViewClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a, button, input, textarea, [contenteditable="true"]')) {
      return;
    }
    enterEditing();
  }, [enterEditing]);

  const onEditorViewKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isEditing && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      enterEditing();
    }
  }, [enterEditing, isEditing]);

  const onEditorViewPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!isEditing) {
      return;
    }
    const pastedUrl = getPastedUrl(event.clipboardData.getData('text/plain'));
    if (!pastedUrl) {
      return;
    }
    event.preventDefault();
    if (isImageUrl(pastedUrl)) {
      void importAssetFromUrl(pastedUrl)
        .then((asset) => insertAsset(asset))
        .catch((error) => {
          setStatus('error');
          setStatusMessage(error instanceof Error ? error.message : 'Image import failed');
        });
      return;
    }
    insertOrUpdateBlockForSlashMenu(editor, {
      type: 'pageLink',
      props: {
        url: pastedUrl,
        title: getUrlTitle(pastedUrl),
      },
    });
  }, [editor, importAssetFromUrl, insertAsset, isEditing]);

  const onEditorMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!isEditing) {
      return;
    }
    const content = (event.target as HTMLElement).closest<HTMLElement>('.bn-block-content[data-content-type="image"]');
    const outer = content?.closest<HTMLElement>('.bn-block-outer');
    const blockId = outer?.dataset.id;
    if (!content || !outer || !blockId) {
      return;
    }
    const editorBox = event.currentTarget.getBoundingClientRect();
    const blockBox = outer.getBoundingClientRect();
    const block = editor.getBlock(blockId);
    const props = block?.props as { caption?: string } | undefined;
    setImageHover({
      blockId,
      top: Math.max(0, blockBox.top - editorBox.top + 4),
      left: Math.max(0, blockBox.right - editorBox.left - 112),
      caption: String(props?.caption || ''),
    });
  }, [editor, isEditing]);

  const openCaptionEditor = useCallback(() => {
    if (!imageHover) {
      return;
    }
    setCaptionEditor({ ...imageHover, value: imageHover.caption });
  }, [imageHover]);

  const saveCaption = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!captionEditor) {
      return;
    }
    editor.updateBlock(captionEditor.blockId, { props: { caption: captionEditor.value.trim() } });
    setCaptionEditor(null);
  }, [captionEditor, editor]);

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
          icon: item.icon ?? null,
          sortKey: item.sortKey,
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

    const onPagesChanged = () => {
      void loadPageList();
    };

    window.addEventListener('beforeunload', unload);
    window.addEventListener('arcane-pages-changed', onPagesChanged);

    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('arcane-pages-changed', onPagesChanged);
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [loadAssets, loadPage, loadPageList, savePage]);

  useEffect(() => {
    setShowLoadingSkeleton(false);
    loadingTimerRef.current = window.setTimeout(() => setShowLoadingSkeleton(true), 1000);
    return () => {
      if (loadingTimerRef.current !== null) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [pageId]);

  if (!page) {
    return status === 'error' ? (
      <section className="editor-shell recovery-notice error" role="alert">
        <strong>{statusMessage || 'Page could not be loaded'}</strong>
        <span>Check the page link or retry after running the workspace health check.</span>
        <button type="button" onClick={() => void loadPage()}>Retry loading page</button>
      </section>
    ) : showLoadingSkeleton ? (
      <PageEditorSkeleton />
    ) : (
      <div className="editor-shell page-transition-placeholder" aria-hidden="true" />
    );
  }

  if (showLoadingSkeleton) {
    return <PageEditorSkeleton />;
  }

  const showTrashNotice = page.deletedAt ? (
    <p className="help status-note" role="status">
      This page is in trash. Restore it before editing.
    </p>
  ) : null;
  const coverAsset = assets.find((asset) => asset.id === page.coverAssetId) ?? null;

  return (
    <section className="document-shell" aria-live="polite">
      <header className="document-topbar">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          {breadcrumbs.length > 0 ? breadcrumbs.map((crumb, index) => (
            <span key={crumb.id} className="breadcrumb-group">
              <span className="breadcrumb-entry">
                {crumb.icon ? <span className="breadcrumb-icon" aria-hidden="true">{crumb.icon}</span> : null}
                <Link className="text-link" href={`/page/${crumb.id}`}>{crumb.title}</Link>
              </span>
              {index + 1 < breadcrumbs.length ? <span className="breadcrumb-separator" aria-hidden="true">/</span> : null}
            </span>
          )) : <Link className="text-link" href="/">Workspace</Link>}
        </nav>
        <details className="action-menu">
          <summary role="button" aria-label="Page actions">•••</summary>
          <div className="action-menu-panel">
            <button type="button" onClick={() => editor.undo()} disabled={isDeleted}>Undo</button>
            <button type="button" onClick={() => editor.redo()} disabled={isDeleted}>Redo</button>
            {coverAsset ? <button type="button" disabled={isDeleted} onClick={beginCoverReposition}>Reposition cover</button> : null}
            <button type="button" disabled={isDeleted} onClick={() => coverUploadRef.current?.click()}>{coverAsset ? 'Replace cover' : 'Add cover'}</button>
            <button type="button" disabled={isDeleted} onClick={() => setCoverUrlOpen(true)}>{coverAsset ? 'Replace cover from URL' : 'Add cover from URL'}</button>
            {coverAsset ? <button type="button" disabled={isDeleted} onClick={() => void updateMetadata({ coverAssetId: null })}>Remove cover</button> : null}
            <button type="button" disabled={isDeleted} onClick={() => bodyUploadRef.current?.click()}>Upload file</button>
            <button type="button" disabled={isDeleted || !page.icon} onClick={() => void updateMetadata({ icon: null })}>Remove icon</button>
            <button type="button" onClick={duplicate} disabled={isDeleted}>Duplicate</button>
            <button type="button" onClick={trash} className="danger-action">{page.deletedAt ? 'Restore' : 'Move to trash'}</button>
          </div>
        </details>
      </header>

      {showTrashNotice}
      {recoveryDraft ? (
        <section className="recovery-notice" role="status">
          <strong>Unsaved browser draft found</strong>
          <span>Your saved page is intact. Restore this draft to review and save it, or discard the draft.</span>
          <div className="toolbar">
            <button type="button" className="primary-btn" onClick={restoreLocalDraft}>Restore draft</button>
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
            <button type="button" className="primary-btn" onClick={() => void overwriteConflict()}>Save my draft over latest</button>
          </div>
        </section>
      ) : null}

      {coverAsset ? (
        <div
          className={`cover-preview ${coverDraft ? 'is-repositioning' : ''}`}
          onPointerDown={onCoverPointerDown}
          onPointerMove={onCoverPointerMove}
          onPointerUp={finishCoverPointer}
          onPointerCancel={finishCoverPointer}
        >
          <Image
            src={`/api/assets/${coverAsset.id}`}
            alt={coverAsset.filename}
            width={1200}
            height={320}
            className="cover-preview-image"
            style={displayedCoverPosition ? {
              objectPosition: `${displayedCoverPosition.x}% ${displayedCoverPosition.y}%`,
              transform: `scale(${displayedCoverPosition.scale / 100})`,
            } : undefined}
            draggable={false}
            unoptimized
          />
          {coverDraft ? (
            <div className="cover-reposition-toolbar" role="group" aria-label="Reposition cover">
              <span>Drag the image to reposition</span>
              <label htmlFor="cover-size"><span>Size</span>
                <input id="cover-size" aria-label="Cover size" type="range" min={100} max={200} step={COVER_SCALE_STEP} value={coverDraft.scale} onChange={(event) => updateCoverScale(Number(event.currentTarget.value))} disabled={isDeleted} />
              </label>
              <button type="button" onClick={() => setCoverDraft(null)}>Cancel</button>
              <button type="button" className="primary-btn" onClick={() => void saveCoverPosition()}>Save</button>
            </div>
          ) : (
            <button type="button" className="cover-reposition-trigger" disabled={isDeleted} onClick={beginCoverReposition}>Reposition cover</button>
          )}
        </div>
      ) : null}

      <div className={`document-content ${coverAsset ? 'has-cover' : ''}`}>
        <div className={`page-identity ${page.icon ? 'has-icon' : ''}`}>
          {!page.icon || !coverAsset ? (
            <div className="page-media-affordances" aria-label="Page appearance">
              {!page.icon ? (
                <button ref={setIconTrigger} key="add-icon" type="button" aria-haspopup="dialog" aria-expanded={iconPickerOpen} disabled={isDeleted} onClick={() => setIconPickerOpen(true)}>Add icon</button>
              ) : null}
              {!coverAsset ? <>
                <button type="button" disabled={isDeleted} onClick={() => coverUploadRef.current?.click()}>Add cover</button>
                <button type="button" disabled={isDeleted} onClick={() => setCoverUrlOpen(true)}>Add cover from URL</button>
              </> : null}
            </div>
          ) : null}
          <div className="page-title-row">
            {page.icon ? (
              <div className="page-icon-wrap">
                <button ref={setIconTrigger} key={`icon-${page.icon}`} type="button" className="page-icon" aria-label="Change page icon" aria-haspopup="dialog" aria-expanded={iconPickerOpen} disabled={isDeleted} onClick={() => setIconPickerOpen((open) => !open)}>{page.icon}</button>
              </div>
            ) : null}
            <textarea className="page-title" rows={1} value={title} onChange={onTitleInput} placeholder="Untitled" disabled={isDeleted} />
          </div>
          {iconPickerOpen ? (
            <PageEmojiPicker currentIcon={page.icon} onSelect={selectPageIcon} onRemove={removePageIcon} onClose={closeIconPicker} />
          ) : null}
          <div className={`status ${status === 'saved' ? 'saved' : status === 'error' || status === 'conflict' ? 'error' : status === 'saving' ? 'saving' : ''}`} role="status">
            <span>{statusMessage || 'Saved'}</span>
            {status === 'error' && hasPendingContent.current ? <button type="button" className="mini-btn" onClick={() => void savePage()}>Retry save</button> : null}
          </div>
        </div>

        <input ref={coverUploadRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => chooseUpload(event, 'cover')} disabled={isDeleted} />
        <input ref={bodyUploadRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown" multiple onChange={(event) => chooseUpload(event, 'body')} disabled={isDeleted} />

        {coverUrlOpen ? (
          <form className="media-url-form" aria-label="Add cover from URL" onSubmit={(event) => void addCoverFromUrl(event)}>
            <label htmlFor="cover-image-url">Cover image URL<input id="cover-image-url" type="url" value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="https://example.com/image.jpg" /></label>
            <button type="submit" className="primary-btn" disabled={isDeleted || !coverUrl.trim()}>Use image</button>
            <button type="button" onClick={() => { setCoverUrl(''); setCoverUrlOpen(false); }}>Cancel</button>
          </form>
        ) : null}

        {imageUrlOpen ? (
          <form
            className="media-url-form image-url-popover"
            aria-label="Insert image from URL"
            style={imageUrlPosition ? { top: imageUrlPosition.top, left: imageUrlPosition.left } : undefined}
            onSubmit={(event) => void addImageFromUrl(event)}
          >
            <label htmlFor="editor-image-url">Image URL<input id="editor-image-url" type="url" autoFocus value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://example.com/image.jpg" /></label>
            <button type="submit" className="primary-btn" disabled={isDeleted || !imageUrl.trim()}>Insert image</button>
            <button type="button" disabled={isDeleted} onClick={() => bodyUploadRef.current?.click()}>Choose file</button>
            <button type="button" onClick={() => { setImageUrl(''); setImageUrlOpen(false); setImageUrlPosition(null); }}>Cancel</button>
          </form>
        ) : null}

        {uploadTasks.length ? (
          <ul className="upload-task-list" aria-label="Uploads">
            {uploadTasks.map((task) => (
              <li key={task.id} className={task.status === 'error' ? 'error' : ''}>
                <span>{task.file.name}</span>
                <span>{task.status === 'uploading' ? 'Uploading…' : task.error}</span>
                {task.status === 'error' ? <div className="toolbar"><button type="button" onClick={() => retryUploadTask(task)}>Retry</button><button type="button" onClick={() => setUploadTasks((current) => current.filter((item) => item.id !== task.id))}>Dismiss</button></div> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div
          className={`editor-view ${isEditing ? 'is-editing' : 'is-reading'}`}
          onClick={onEditorViewClick}
          onKeyDown={onEditorViewKeyDown}
          onPaste={onEditorViewPaste}
          onMouseMove={onEditorMouseMove}
          onMouseLeave={() => { if (!captionEditor) setImageHover(null); }}
          tabIndex={isEditing || isDeleted ? -1 : 0}
          aria-label={isEditing ? undefined : 'Page content. Click to edit.'}
        >
          <BlockNoteView editor={editor} slashMenu={false} editable={isEditing && !isDeleted} theme="dark">
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={getSlashMenuItems}
              suggestionMenuComponent={ArcaneSuggestionMenu}
            />
            <SuggestionMenuController
              triggerCharacter="@"
              minQueryLength={1}
              getItems={getMentionItems}
              onItemClick={(item) => insertMention(item as MentionItem)}
              suggestionMenuComponent={ArcaneSuggestionMenu}
            />
          </BlockNoteView>
          {imageHover && !captionEditor ? (
            <button
              type="button"
              className="image-caption-trigger"
              style={{ top: imageHover.top, left: imageHover.left }}
              onClick={openCaptionEditor}
            >
              {imageHover.caption ? 'Edit caption' : 'Add caption'}
            </button>
          ) : null}
          {captionEditor ? (
            <form className="image-caption-editor" style={{ top: captionEditor.top, left: captionEditor.left }} onSubmit={saveCaption}>
              <label htmlFor="image-caption-input" className="visually-hidden">Image caption</label>
              <input id="image-caption-input" autoFocus value={captionEditor.value} onChange={(event) => setCaptionEditor((current) => current ? { ...current, value: event.target.value } : current)} placeholder="Add a caption" />
              <button type="submit" className="primary-btn">Save</button>
            </form>
          ) : null}
        </div>

      </div>
    </section>
  );
}
