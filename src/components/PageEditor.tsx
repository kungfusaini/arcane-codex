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
  type ReactElement,
} from 'react';
import { BlockNoteSchema, PartialBlock, defaultBlockSpecs } from '@blocknote/core';
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
  coverFocalX: number;
  coverFocalY: number;
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
const EMOJI_OPTIONS = ['📄', '🧾', '📚', '⚡', '✨', '🗂️', '🧠', '✍️', '🗒️', '🎯', '🛠️', '🧪', '📌', '🧭', '🔖', '🧩'];

function isSupportedUpload(file: File): boolean {
  return file.size <= 20 * 1024 * 1024 && ALLOWED_UPLOAD_TYPES.includes(file.type.toLowerCase());
}

type ReferencedPage = {
  title: string;
  icon: string | null;
};

function createPageLinkBlockSpec(referencedPages: Map<string, ReferencedPage>) {
  const getReference = (pageId: string): ReferencedPage => {
    return referencedPages.get(pageId) || { title: 'Page', icon: null };
  };

  return createReactBlockSpec(
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
        const reference = pageId ? getReference(pageId) : { title: String(propsByType.title || 'Page'), icon: null };
        const label = `${reference.icon ? `${reference.icon} ` : ''}${reference.title || String(propsByType.title || 'Page')}`;
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
          >
            {label}
          </a>
        );
      },
      toExternalHTML: (props) => {
        const propsByType = props.block.props as { pageId?: string; title?: string };
        const pageId = String(propsByType.pageId || '');
        const reference = pageId ? getReference(pageId) : { title: String(propsByType.title || 'Page'), icon: null };
        const label = `${reference.icon ? `${reference.icon} ` : ''}${reference.title || String(propsByType.title || 'Page')}`;
        return <a href={pageId ? `/page/${pageId}` : '#'}>{label}</a>;
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
            caption: asset.filename,
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

  const draftKey = `arcane-codex:draft:${pageId}`;
  const isDeleted = Boolean(page?.deletedAt);

  const coverPositionPercent = page?.coverAssetId
    ? {
        x: Number.isFinite(page.coverFocalX) ? Math.round(page.coverFocalX / COVER_FOCAL_STEP) * COVER_FOCAL_STEP : 50,
        y: Number.isFinite(page.coverFocalY) ? Math.round(page.coverFocalY / COVER_FOCAL_STEP) * COVER_FOCAL_STEP : 50,
      }
    : null;

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

      const payload = (await response.json()) as { page: PageRecord; backlinks: PageRecord[] };
      setPage(payload.page);
      setBacklinks(payload.backlinks);
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

        canFlushQueuedSave = true;
        pendingRevision.current = payload.page.revision;
        setPage(payload.page);
        setBacklinks(payload.backlinks ?? []);
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

  const updateMetadata = useCallback(async (updates: { icon?: string | null; coverAssetId?: string | null; coverFocalX?: number; coverFocalY?: number }) => {
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
    window.dispatchEvent(new Event('arcane-pages-changed'));
    setStatus('saved');
    setStatusMessage('Page details saved');
  }, [page, pageId, savePage]);

  const updateCoverFocal = useCallback((axis: 'x' | 'y', value: number) => {
    if (!page || !page.coverAssetId) {
      return;
    }
    const nextX = axis === 'x' ? clampCoverFocal(value) : page.coverFocalX;
    const nextY = axis === 'y' ? clampCoverFocal(value) : page.coverFocalY;
    void updateMetadata({
      coverFocalX: nextX,
      coverFocalY: nextY,
    });
  }, [clampCoverFocal, page, updateMetadata]);

  const insertAsset = useCallback((asset: AssetRecord, blockId?: string) => {
    const url = `/api/assets/${asset.id}`;
    const block = asset.mimeType.startsWith('image/')
      ? { type: 'image', props: { url, name: asset.filename, caption: asset.filename } }
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

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>, target: 'body' | 'cover') => {
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

  const onTitleInput = (event: ChangeEvent<HTMLInputElement>) => {
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

  const getSlashMenuItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & { pageId?: string })[]> => {
    const defaultItems = filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query);
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
    const pages = pageSuggestions(query).map((item) => ({
      title: `Page: ${item.title || 'Untitled'}`,
      subtext: 'Insert page card',
      onItemClick: () => {
        insertPageCard(item);
      },
      pageId: item.id,
      group: 'Pages',
    }));

    return [...defaultItems, ...createChildItem, ...pages];
  }, [createChildPageCard, editor, insertPageCard, pageSuggestions]);

  const insertMention = useCallback(
    (item: MentionItem) => {
      editor.insertInlineContent({
        type: 'link',
        href: `/page/${item.id}`,
        content: item.label,
      } as unknown as Parameters<typeof editor.insertInlineContent>[0]);
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

  if (!page) {
    return status === 'error' ? (
      <section className="editor-shell recovery-notice error" role="alert">
        <strong>{statusMessage || 'Page could not be loaded'}</strong>
        <span>Check the page link or retry after running the workspace health check.</span>
        <button type="button" onClick={() => void loadPage()}>Retry loading page</button>
      </section>
    ) : (
      <div className="editor-shell help" role="status">Loading page…</div>
    );
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
            style={
              coverPositionPercent
                ? {
                    objectPosition: `${coverPositionPercent.x}% ${coverPositionPercent.y}%`,
                  }
                : undefined
            }
            unoptimized
          />
          {page?.coverAssetId ? (
            <div className="cover-controls" role="group" aria-label="Cover focal point">
              <label htmlFor="cover-focal-x">
                Horizontal
                <input
                  id="cover-focal-x"
                  type="range"
                  min={0}
                  max={100}
                  step={COVER_FOCAL_STEP}
                  value={coverPositionPercent?.x ?? 50}
                  onChange={(event) => {
                    updateCoverFocal('x', Number(event.currentTarget.value));
                  }}
                  disabled={isDeleted}
                />
              </label>
              <label htmlFor="cover-focal-y">
                Vertical
                <input
                  id="cover-focal-y"
                  type="range"
                  min={0}
                  max={100}
                  step={COVER_FOCAL_STEP}
                  value={coverPositionPercent?.y ?? 50}
                  onChange={(event) => {
                    updateCoverFocal('y', Number(event.currentTarget.value));
                  }}
                  disabled={isDeleted}
                />
              </label>
            </div>
          ) : null}
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
                    retryUploadTask(task);
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
        <span>{statusMessage || 'Saved'}</span>
        {status === 'error' && hasPendingContent.current ? (
          <button type="button" className="mini-btn" onClick={() => void savePage()}>
            Retry save
          </button>
        ) : null}
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
