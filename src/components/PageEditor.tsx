"use client";

import dynamic from 'next/dynamic';
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
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { BlockNoteSchema, PartialBlock, defaultBlockSpecs } from '@blocknote/core';
import {
  BlockNoteViewRaw as BlockNoteView,
  SideMenuController,
  SuggestionMenuController,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  useBlockNoteEditor,
  useEditorChange,
  useExtension,
  useExtensionState,
} from '@blocknote/react';
import {
  SideMenuExtension,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import { getBreadcrumbs } from '@/lib/pageTree';
import { PageIcon } from '@/components/PageIcon';
import { extractGrabberPaste, ImageGrabberPanel, ImageGrabberPromptForm, ImageGrabberUrlForm } from '@/components/ImageGrabberControls';
import { ImageGrabberPopup, ImagePopupSection } from '@/components/ImageGrabberPopup';
import { PublishMediaModal, PublishMediaTrigger, type PublishMediaItem } from '@/components/PublishMediaModal';
import { useDismissibleDetails } from '@/components/useDismissibleDetails';
import { buildWorkspacePagePathFromPages, findWorkspaceHomePage, isWorkspacePagePathForId } from '@/lib/workspaceHome';
import {
  editGrabberImageToAsset,
  IMAGE_GRABBER_UPLOAD_TYPES,
  importGrabberAssetFromUrl,
  isLikelyImageUrl,
  isSupportedGrabberUpload,
  normalizeHttpUrl,
  uploadGrabberAsset,
} from '@/lib/imageGrabber';
import { PageEditorSkeleton } from '@/components/PageEditorSkeleton';
import {
  createCustomBlockSpecs,
  getCustomSlashMenuItems,
  getYouTubeVideoId,
  type ReferencedPage,
} from '@/components/customBlocks';

import './page-editor.css';

type PageRecord = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
  iconAssetId: string | null;
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
  iconAssetId: string | null;
};

type CollectionSummary = {
  id: string;
  hostPageId: string | null;
  name: string;
};

type PageCollectionsPayload = {
  collections?: CollectionSummary[];
  hostCollection?: CollectionSummary | null;
};

const PageEmojiPicker = dynamic(
  () => import('@/components/PageEmojiPicker').then((module) => module.PageEmojiPicker),
  { ssr: false },
);

const CollectionEditor = dynamic(
  () => import('@/components/CollectionEditor').then((module) => module.CollectionEditor),
  { ssr: false },
);

const COVER_FOCAL_STEP = 5;
const COVER_SCALE_STEP = 5;
const defaultBlockSpecsWithoutImage = Object.fromEntries(
  Object.entries(defaultBlockSpecs).filter(([type]) => type !== 'image'),
) as typeof defaultBlockSpecs;

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
  target: 'body' | 'cover' | 'icon';
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

function isTrulyEmptyParagraph(block: { type: string; content: unknown }) {
  return block.type === 'paragraph'
    && Array.isArray(block.content)
    && block.content.every((inline) => (
      typeof inline === 'object'
      && inline !== null
      && 'type' in inline
      && inline.type === 'text'
      && 'text' in inline
      && inline.text === ''
    ));
}

function isSupportedUpload(file: File): boolean {
  return isSupportedGrabberUpload(file, IMAGE_GRABBER_UPLOAD_TYPES);
}

function getPastedUrl(value: string): string | null {
  return normalizeHttpUrl(value);
}

function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
  const seconds = parts.length === 1
    ? parts[0]
    : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2];
  return seconds >= 0 ? seconds : null;
}

function getUrlTitle(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function replaceImageBlockUrl(blocks: unknown, blockId: string, url: string): { blocks: unknown; changed: boolean } {
  if (!Array.isArray(blocks)) return { blocks, changed: false };
  let changed = false;
  const next = blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    const record = block as Record<string, unknown>;
    let updated: Record<string, unknown> = record;
    if (record.id === blockId) {
      updated = { ...updated, props: { ...(record.props as Record<string, unknown>), url } };
      changed = true;
    }
    const children = replaceImageBlockUrl(record.children, blockId, url);
    if (children.changed) {
      updated = { ...updated, children: children.blocks };
      changed = true;
    }
    return updated;
  });
  return { blocks: next, changed };
}

async function saveEditedImageToPage(pageId: string, blockId: string, url: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`/api/pages/${pageId}`);
    const payload = await response.json() as { page?: Pick<PageRecord, 'revision' | 'contentJson'>; error?: string };
    if (!response.ok || !payload.page) throw new Error(payload.error || 'Original page could not be loaded.');
    const replaced = replaceImageBlockUrl(JSON.parse(payload.page.contentJson), blockId, url);
    if (!replaced.changed) throw new Error('The original image block no longer exists.');
    const update = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: payload.page.revision, contentJson: JSON.stringify(replaced.blocks) }),
    });
    if (update.ok) return;
    if (update.status !== 409 || attempt === 1) {
      const error = await update.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error || 'Edited image could not be saved.');
    }
  }
}

function isImageUrl(value: string): boolean {
  return isLikelyImageUrl(value);
}

function migrateLegacyImageBlocks(blocks: PartialBlock[]): { blocks: PartialBlock[]; changed: boolean } {
  let changed = false;
  const next = blocks.map((block) => {
    const record = block as PartialBlock & { props?: Record<string, unknown>; children?: PartialBlock[] };
    let migrated = record;
    if (record.type === 'image' && typeof record.props?.url === 'string' && record.props.url) {
      const name = typeof record.props.name === 'string' && record.props.name ? record.props.name : record.props.url;
      migrated = {
        ...record,
        type: 'gallery',
        props: {
          images: JSON.stringify([{
            url: record.props.url,
            name,
            caption: typeof record.props.caption === 'string' ? record.props.caption : '',
          }]),
          imageSize: 240,
          mode: 'single',
          captionMode: 'individual',
          groupCaption: '',
        },
      } as unknown as PartialBlock & { props?: Record<string, unknown>; children?: PartialBlock[] };
      changed = true;
    }
    if (Array.isArray(record.children)) {
      const children = migrateLegacyImageBlocks(record.children);
      if (children.changed) {
        migrated = { ...migrated, children: children.blocks };
        changed = true;
      }
    }
    return migrated;
  });
  return { blocks: next, changed };
}

function removeRedundantYouTubeLinkBlocks(blocks: PartialBlock[]): PartialBlock[] {
  return blocks.filter((block, index) => {
    if (block.type !== 'paragraph' || !Array.isArray(block.content) || block.content.length !== 1) {
      return true;
    }
    const inline = block.content[0] as { type?: string; href?: string } | undefined;
    const next = blocks[index + 1] as { type?: string; props?: Record<string, unknown> } | undefined;
    if (inline?.type !== 'link' || typeof inline.href !== 'string' || next?.type !== 'youtube') {
      return true;
    }
    return getYouTubeVideoId(inline.href) !== getYouTubeVideoId(String(next.props?.url || ''));
  });
}

function ArcaneSideMenu() {
  const editor = useBlockNoteEditor();
  const sideMenu = useExtension(SideMenuExtension);
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  const moveBlock = (direction: -1 | 1) => {
    if (!block) {
      return;
    }
    const blocks = editor.document;
    const index = blocks.findIndex((candidate) => candidate.id === block.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) {
      return;
    }
    const source = blocks[index];
    const target = blocks[targetIndex];
    if (!source || !target) {
      return;
    }
    const partialSource = { ...source };
    delete (partialSource as { id?: string }).id;
    editor.insertBlocks([partialSource], target, direction < 0 ? 'before' : 'after');
    editor.removeBlocks([source]);
  };

  useEffect(() => {
    if (!block) {
      return;
    }
    const up = moveUpRef.current;
    const down = moveDownRef.current;
    const moveUp = (event: globalThis.MouseEvent) => { event.preventDefault(); moveBlock(-1); };
    const moveDown = (event: globalThis.MouseEvent) => { event.preventDefault(); moveBlock(1); };
    up?.addEventListener('click', moveUp);
    down?.addEventListener('click', moveDown);
    return () => {
      up?.removeEventListener('click', moveUp);
      down?.removeEventListener('click', moveDown);
    };
  });

  if (!block) {
    return null;
  }

  return (
    <div className="arcane-side-menu-actions">
      <button
      type="button"
      className="arcane-drag-handle"
      draggable
      aria-label="Drag block"
      onDragStart={(event) => sideMenu.blockDragStart(event, block)}
      onDragEnd={sideMenu.blockDragEnd}
      title="Drag block"
    >
      ⋮⋮
    </button>
      <button type="button" ref={moveUpRef} className="arcane-move-button" aria-label="Move block up" title="Move block up">↑</button>
      <button type="button" ref={moveDownRef} className="arcane-move-button" aria-label="Move block down" title="Move block down">↓</button>
    </div>
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

type PageEditorProps = { pageId: string; initialPage?: PageRecord; initialPages?: SidebarPage[]; readOnly?: boolean; pageRouteBasePath?: string };

export function PageEditor({ pageId, initialPage, initialPages = [], readOnly = false, pageRouteBasePath = '/' }: PageEditorProps) {
  useDismissibleDetails('.action-menu');

  const [page, setPage] = useState<PageRecord | null>(initialPage ?? null);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  const [title, setTitle] = useState(initialPage?.title ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [allPages, setAllPages] = useState<SidebarPage[]>(initialPages);
  const [editorReady, setEditorReady] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [hostCollection, setHostCollection] = useState<CollectionSummary | null>(null);
  const [pageCollections, setPageCollections] = useState<CollectionSummary[]>([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerPosition, setIconPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [pageIconPrompt, setPageIconPrompt] = useState('');
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [coverUrlOpen, setCoverUrlOpen] = useState(false);
  const [coverUrl, setCoverUrl] = useState('');
  const [imageUrlOpen, setImageUrlOpen] = useState(false);
  const [imageUrlPosition, setImageUrlPosition] = useState<{ top: number; left: number } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [timeComposerOpen, setTimeComposerOpen] = useState(false);
  const [timeComposerValue, setTimeComposerValue] = useState('');
  const [timeComposerError, setTimeComposerError] = useState('');
  const [imageHover, setImageHover] = useState<{ pageId: string; blockId: string; top: number; left: number; caption: string; url: string; imageTop: number; imageLeft: number; width: number; height: number } | null>(null);
  const [generatingImage, setGeneratingImage] = useState<{ pageId: string; top: number; left: number; width: number; height: number } | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imagePromptBusy, setImagePromptBusy] = useState(false);
  const [captionEditor, setCaptionEditor] = useState<{ blockId: string; top: number; left: number; value: string } | null>(null);
  const [publishMediaItems, setPublishMediaItems] = useState<PublishMediaItem[]>([]);
  const [publishMediaIndex, setPublishMediaIndex] = useState<number | null>(null);
  const [conflictPage, setConflictPage] = useState<PageRecord | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const [coverDraft, setCoverDraft] = useState<{ x: number; y: number; scale: number } | null>(null);

  const referencedPages = useMemo(() => {
    const map = new Map<string, ReferencedPage>();
    for (const item of allPages) {
      map.set(item.id, { id: item.id, parentId: item.parentId, sortKey: item.sortKey, title: item.title || 'Untitled', icon: item.icon ?? null, iconAssetId: item.iconAssetId ?? null });
    }
    return map;
  }, [allPages]);

  useEffect(() => {
    try {
      setPageIconPrompt(window.localStorage.getItem(`arcane-page-icon-prompt:${pageId}`)?.trim() ?? '');
    } catch {
      setPageIconPrompt('');
    }
  }, [pageId]);

  const pageIconPromptCaption = pageIconPrompt ? `Prompt: ${pageIconPrompt}` : undefined;

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

  const rememberAsset = useCallback((asset: AssetRecord) => {
    setAssets((current) => [asset, ...current.filter((existing) => existing.id !== asset.id)]);
  }, []);

  const importAssetFromUrl = useCallback(async (url: string): Promise<AssetRecord> => {
    const asset = await importGrabberAssetFromUrl(url) as AssetRecord;
    rememberAsset(asset);
    return asset;
  }, [rememberAsset]);

  const uploadAssetRecord = useCallback(async (file: File): Promise<AssetRecord> => {
    const asset = await uploadGrabberAsset(file) as AssetRecord;
    rememberAsset(asset);
    return asset;
  }, [rememberAsset]);

  const editor = useCreateBlockNote({
    schema: useMemo(
      () =>
        BlockNoteSchema.create({
          blockSpecs: {
            ...defaultBlockSpecsWithoutImage,
            ...createCustomBlockSpecs({ referencedPages, importAssetFromUrl, uploadAssetRecord, readOnly, pageRouteBasePath }),
          },
        }),
      [importAssetFromUrl, referencedPages, readOnly, pageRouteBasePath, uploadAssetRecord],
    ),
    trailingBlock: false,
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
  const pendingRevision = useRef(initialPage?.revision ?? 0);
  const savedDocRef = useRef(initialPage?.contentJson ?? '[]');
  const titleRef = useRef(initialPage?.title ?? '');
  const bodyUploadRef = useRef<HTMLInputElement>(null);
  const coverUploadRef = useRef<HTMLInputElement>(null);
  const iconUploadRef = useRef<HTMLInputElement>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreIconFocusRef = useRef(false);
  const coverDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const clickCreatedBlockIdsRef = useRef(new Set<string>());

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

    const withoutRedundantLinks = removeRedundantYouTubeLinkBlocks(parsed.length ? parsed : DOCUMENT_FALLBACK);
    const migrated = migrateLegacyImageBlocks(withoutRedundantLinks);
    const payload = migrated.blocks;
    isApplyingRemoteContent.current = true;
    editor.replaceBlocks(editor.document, payload as Parameters<typeof editor.replaceBlocks>[1]);
    savedDocRef.current = JSON.stringify(payload);
    queueMicrotask(() => {
      isApplyingRemoteContent.current = false;
    });
    return migrated.changed;
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
      // Older image-edit attempts could leave a huge base64 draft in localStorage;
      // those payloads cannot be sent reliably as a recovery PATCH.
      if (draft.contentJson.includes('data:image/') || draft.contentJson.length > 4_500_000) {
        window.localStorage.removeItem(draftKey);
        return null;
      }
      // A draft from an older server revision cannot safely be restored over a
      // newer page. It is stale recovery state, not an unsaved current edit.
      if (draft.baseRevision !== remote.revision || (draft.title === remote.title && draft.contentJson === remote.contentJson)) {
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

      const payload = (await response.json()) as { page: PageRecord; backlinks?: SidebarPage[] } & PageCollectionsPayload;
      setPage(payload.page);
      setPageCollections(payload.collections ?? []);
      setHostCollection(payload.hostCollection ?? null);
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

      const migratedLegacyImages = applyInitialContent(payload.page.contentJson);
      if (migratedLegacyImages && !readOnly) {
        const migrationResponse = await fetch(`/api/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentJson: savedDocRef.current, revision: payload.page.revision }),
        });
        if (migrationResponse.ok) {
          const migrationPayload = await migrationResponse.json() as { page?: PageRecord };
          if (migrationPayload.page) {
            setPage(migrationPayload.page);
            pendingRevision.current = migrationPayload.page.revision;
          }
        }
      }

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
  }, [applyInitialContent, pageId, readRecoveryDraft, readOnly]);

  const loadPageList = useCallback(async () => {
    const response = await fetch('/api/pages');
    const payload = (await response.json()) as { pages: SidebarPage[] };
    setAllPages(payload.pages);
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

  const updateMetadata = useCallback(async (updates: { icon?: string | null; iconAssetId?: string | null; coverAssetId?: string | null; coverFocalX?: number; coverFocalY?: number; coverScale?: number }) => {
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

  const openIconPicker = useCallback(() => {
    const trigger = iconTriggerRef.current;
    if (trigger) {
      const bounds = trigger.getBoundingClientRect();
      const popupWidth = 440;
      const popupHeight = 560;
      const margin = 8;
      const belowTop = bounds.bottom + margin;
      const aboveTop = bounds.top - popupHeight - margin;
      const top = belowTop + popupHeight <= window.innerHeight - margin ? belowTop : aboveTop;
      setIconPickerPosition({
        top: Math.max(margin, top),
        left: Math.max(margin, Math.min(bounds.left, window.innerWidth - popupWidth - margin)),
      });
    } else {
      setIconPickerPosition(null);
    }
    setIconPickerOpen(true);
  }, []);

  const closeIconPicker = useCallback((reason: 'escape' | 'outside' | 'button') => {
    setIconPickerOpen(false);
    setIconPickerPosition(null);
    if (reason !== 'outside') {
      window.requestAnimationFrame(() => iconTriggerRef.current?.focus());
    }
  }, []);

  const selectPageIcon = useCallback((emoji: string) => {
    restoreIconFocusRef.current = true;
    setIconPickerOpen(false);
    void updateMetadata({ icon: emoji, iconAssetId: null });
  }, [updateMetadata]);

  const selectPageIconAsset = useCallback((assetId: string) => {
    void updateMetadata({ icon: null, iconAssetId: assetId });
  }, [updateMetadata]);

  const removePageIcon = useCallback(() => {
    restoreIconFocusRef.current = true;
    setIconPickerOpen(false);
    void updateMetadata({ icon: null, iconAssetId: null });
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
      ? { type: 'gallery', props: { images: JSON.stringify([{ url, name: asset.filename, caption: '' }]), imageSize: 240, mode: 'grid', captionMode: 'individual', groupCaption: '' } }
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

  const uploadForIcon = useCallback(async (file: File, taskId: string) => {
    const asset = await uploadAssetRecord(file);
    await updateMetadata({ icon: null, iconAssetId: asset.id });
    removeUploadTask(taskId);
    return asset;
  }, [removeUploadTask, updateMetadata, uploadAssetRecord]);

  const uploadAndHandleTask = useCallback(async (file: File, target: 'body' | 'cover' | 'icon', blockId?: string) => {
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
      if (target === 'icon') {
        await uploadForIcon(file, taskId);
        return;
      }
      await uploadForBody(file, taskId);
    } catch (error) {
      setUploadTask(taskId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  }, [addUploadTask, setUploadTask, uploadForBody, uploadForCover, uploadForIcon]);

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

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>, target: 'body' | 'cover' | 'icon') => {
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
    window.location.href = buildWorkspacePagePathFromPages(payload.page.id, [...allPages, payload.page], pageRouteBasePath);
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
      iconAssetId: pageInfo?.iconAssetId ?? null,
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
    } as never);
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

  const openTimeComposer = useCallback(() => {
    setTimeComposerValue('');
    setTimeComposerError('');
    setTimeComposerOpen(true);
  }, []);

  const insertTimestamp = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const seconds = parseTimestamp(timeComposerValue);
    if (seconds === null) {
      setTimeComposerError('Use seconds or a timestamp like 1:23.');
      return;
    }
    const label = timeComposerValue.trim() || `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    editor.insertInlineContent([{ type: 'link', href: `#youtube-time-${seconds}`, content: label }, ' ']);
    setTimeComposerOpen(false);
    setTimeComposerValue('');
    setTimeComposerError('');
  }, [editor, timeComposerValue]);

  const openPublishMedia = useCallback((item: PublishMediaItem) => {
    setPublishMediaItems([item]);
    setPublishMediaIndex(0);
  }, []);

  const openImageUrlPicker = useCallback(() => {
    const selection = editor.getSelectionBoundingBox();
    setImageUrlPosition(selection ? {
      top: Math.min(selection.bottom + 8, window.innerHeight - 180),
      left: Math.min(selection.left, window.innerWidth - 460),
    } : null);
    setImageUrlOpen(true);
  }, [editor]);

  const getSlashMenuItems = useCallback(async (query: string): Promise<(DefaultReactSuggestionItem & { pageId?: string })[]> => {
    const defaultItems = filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)
      .filter((item) => (item as DefaultReactSuggestionItem & { key?: string }).key !== 'image');
    const normalized = query.trim().toLowerCase();
    const customItems = getCustomSlashMenuItems({
      editor,
      referencedPages,
      insertBlock: (block) => insertOrUpdateBlockForSlashMenu(editor, block),
      importAssetFromUrl,
      uploadAssetRecord,
    }, query);
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
    const timeItem = !normalized || 'time timestamp'.includes(normalized)
      ? [{
          title: 'Time timestamp',
          subtext: 'Insert a clickable timestamp for the YouTube player',
          onItemClick: openTimeComposer,
          group: 'Media',
        }]
      : [];
    const imageUrlItem = !normalized || 'gallery from url image'.includes(normalized)
      ? [{
          title: 'Gallery from URL',
          subtext: 'Create a gallery block from an image URL',
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

    return [...defaultItems, ...customItems, ...timeItem, ...imageUrlItem, ...createChildItem, ...pages];
  }, [createChildPageCard, editor, importAssetFromUrl, insertPageCard, openImageUrlPicker, openTimeComposer, pageSuggestions, referencedPages, uploadAssetRecord]);

  const insertMention = useCallback(
    (item: MentionItem) => {
      editor.insertInlineContent([{
        type: 'link',
        href: buildWorkspacePagePathFromPages(item.id, allPages, pageRouteBasePath),
        content: item.label,
      }]);
    },
    [allPages, editor],
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
    if (readOnly || !editorReady || isApplyingRemoteContent.current || !isEditing) {
      return;
    }

    const documentJson = JSON.stringify(editor.document);
    savedDocRef.current = documentJson;
    requestSave();
  }, editor);

  const enterEditing = useCallback(() => {
    if (readOnly || isDeleted) {
      return;
    }
    setIsEditing(true);
    window.requestAnimationFrame(() => editor.focus());
  }, [editor, isDeleted, readOnly]);

  const appendParagraphBlock = useCallback(() => {
    const lastBlock = editor.document.at(-1);
    if (!lastBlock) {
      return;
    }
    const [insertedBlock] = editor.insertBlocks([{ type: 'paragraph' }], lastBlock, 'after');
    clickCreatedBlockIdsRef.current.add(insertedBlock.id);
    editor.setTextCursorPosition(insertedBlock, 'start');
    editor.focus();
  }, [editor]);

  const onEditorViewMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a[href^="#youtube-time-"], a[href^="youtube-time:"]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!readOnly) {
      return;
    }

    const publishMediaTrigger = target.closest('.publish-media-trigger');
    const publishImage = target.closest<HTMLImageElement>('img');
    const readonlyNodeView = target.closest('.bn-react-node-view-renderer');
    const readonlyMediaBlock = target.closest('.bn-block-content[data-content-type="image"], .bn-block-content[data-content-type="file"]');
    if (publishMediaTrigger || readonlyNodeView || readonlyMediaBlock || (publishImage && !publishImage.closest('a, button'))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [readOnly]);

  const onEditorViewClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const timestampLink = target.closest<HTMLAnchorElement>('a[href^="#youtube-time-"], a[href^="youtube-time:"]');
    if (timestampLink) {
      const timestampHref = timestampLink.getAttribute('href') || '';
      const seconds = Number(timestampHref.startsWith('#youtube-time-')
        ? timestampHref.slice('#youtube-time-'.length)
        : timestampHref.slice('youtube-time:'.length));
      if (Number.isFinite(seconds)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('arcane-youtube-seek', { detail: { seconds } }));
      }
      return;
    }
    const publishImage = readOnly ? target.closest<HTMLImageElement>('img') : null;
    if (publishImage && !publishImage.closest('a, button')) {
      event.preventDefault();
      openPublishMedia({
        type: 'image',
        src: publishImage.currentSrc || publishImage.src,
        alt: publishImage.alt,
        label: publishImage.alt || 'Published image',
      });
      return;
    }
    if (target.closest('a, button, input, textarea, .bn-trailing-block')) {
      return;
    }
    if (target.closest('.bn-block-outer')) {
      if (!isEditing) {
        enterEditing();
      }
      return;
    }
    if (!isEditing) {
      setIsEditing(true);
      window.requestAnimationFrame(appendParagraphBlock);
      return;
    }
    appendParagraphBlock();
  }, [appendParagraphBlock, enterEditing, isEditing, openPublishMedia, readOnly]);

  const onEditorViewBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    const emptyBlocks = editor.document.filter(isTrulyEmptyParagraph);
    const blocksToRemove = emptyBlocks.filter((block) => clickCreatedBlockIdsRef.current.has(block.id));
    editor.document.forEach((block) => {
      if (!isTrulyEmptyParagraph(block)) {
        clickCreatedBlockIdsRef.current.delete(block.id);
      }
    });
    if (blocksToRemove.length) {
      blocksToRemove.forEach((block) => clickCreatedBlockIdsRef.current.delete(block.id));
      editor.removeBlocks(blocksToRemove);
    }
  }, [editor]);

  const onEditorViewKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      clickCreatedBlockIdsRef.current.clear();
    }
    if (!isEditing && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      enterEditing();
    }
  }, [enterEditing, isEditing]);

  const onEditorViewPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!isEditing) {
      return;
    }
    const pastedImage = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (pastedImage) {
      event.preventDefault();
      void uploadAssetRecord(pastedImage)
        .then((asset) => insertAsset(asset))
        .catch((error) => {
          setStatus('error');
          setStatusMessage(error instanceof Error ? error.message : 'Image import failed');
        });
      return;
    }
    const pastedUrl = getPastedUrl(event.clipboardData.getData('text/plain'));
    if (!pastedUrl) {
      return;
    }
    event.preventDefault();
    if (getYouTubeVideoId(pastedUrl)) {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: 'youtube',
        props: { url: pastedUrl },
      } as never);
      return;
    }
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
    } as never);
  }, [editor, importAssetFromUrl, insertAsset, isEditing, uploadAssetRecord]);

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
    const props = block?.props as { caption?: string; url?: string } | undefined;
    setImageHover({
      pageId,
      blockId,
      top: Math.max(0, blockBox.top - editorBox.top + 4),
      left: Math.max(0, blockBox.right - editorBox.left - 180),
      caption: String(props?.caption || ''),
      url: String(props?.url || ''),
      imageTop: Math.max(0, blockBox.top - editorBox.top),
      imageLeft: Math.max(0, blockBox.left - editorBox.left),
      width: blockBox.width,
      height: blockBox.height,
    });
  }, [editor, isEditing, pageId]);

  const openCaptionEditor = useCallback(() => {
    if (!imageHover) {
      return;
    }
    setCaptionEditor({ ...imageHover, value: imageHover.caption });
  }, [imageHover]);

  const applyImagePrompt = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!imageHover || !imagePrompt.trim() || imagePromptBusy) return;
    setImagePromptBusy(true);
    setGeneratingImage({ pageId, top: imageHover.imageTop, left: imageHover.imageLeft, width: imageHover.width, height: imageHover.height });
    setStatusMessage('Applying image edit…');
    try {
      const grabbed = await editGrabberImageToAsset(imageHover.url, imagePrompt);
      rememberAsset(grabbed.asset as AssetRecord);
      const editedUrl = grabbed.url;
      if (isWorkspacePagePathForId(window.location.pathname, pageId, allPages)) {
        editor.updateBlock(imageHover.blockId, { props: { url: editedUrl } });
        window.requestAnimationFrame(() => { void savePage(); });
      } else {
        await saveEditedImageToPage(pageId, imageHover.blockId, editedUrl);
      }
      setImagePrompt('');
      setImageHover(null);
      setStatus('saved');
      setStatusMessage('Image edit applied.');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Image edit failed.');
    } finally {
      setGeneratingImage(null);
      setImagePromptBusy(false);
    }
  }, [allPages, editor, imageHover, imagePrompt, imagePromptBusy, pageId, rememberAsset, savePage]);

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
      iconAssetId: string | null;
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
          iconAssetId: item.iconAssetId ?? null,
          sortKey: item.sortKey,
        },
      ]),
    );
    const chain = getBreadcrumbs(breadcrumbMap as unknown as Map<string, BreadcrumbEntry>, pageId);
    const workspaceHome = findWorkspaceHomePage(allPages);
    if (!workspaceHome || chain[0]?.id === workspaceHome.id) {
      return chain;
    }
    return [workspaceHome, ...chain];
  }, [allPages, pageId]);

  useEffect(() => {
    if (initialPage) {
      setPage(initialPage);
      setTitle(initialPage.title);
      titleRef.current = initialPage.title;
      pendingRevision.current = initialPage.revision;
      setShowLoadingSkeleton(false);
      if (loadingTimerRef.current !== null) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      applyInitialContent(initialPage.contentJson);
      setEditorReady(true);
    }
    void loadPage();
    if (initialPages.length === 0) {
      void loadPageList();
    }
    const unload = () => {
      if (hasPendingContent.current) {
        clearTimeout(saveTimerRef.current ?? undefined);
        void savePage();
      }
    };

    const onPagesChanged = () => {
      void loadPageList();
      void loadPage();
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
  }, [applyInitialContent, initialPage, initialPages.length, loadPage, loadPageList, savePage]);

  useEffect(() => {
    setShowLoadingSkeleton(false);
    if (page) {
      return;
    }
    loadingTimerRef.current = window.setTimeout(() => setShowLoadingSkeleton(true), 1000);
    return () => {
      if (loadingTimerRef.current !== null) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [page, pageId]);

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
  const coverAsset = page.coverAssetId
    ? assets.find((asset) => asset.id === page.coverAssetId) ?? { id: page.coverAssetId, filename: 'Cover image' }
    : null;
  if (readOnly) {
    return (
      <section className="document-shell" aria-live="polite">
        <header className="document-topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumbs">
            {breadcrumbs.length > 0 ? breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="breadcrumb-group">
                <span className="breadcrumb-entry">
                  {crumb.icon || crumb.iconAssetId ? <PageIcon className="breadcrumb-icon" icon={crumb.icon} iconAssetId={crumb.iconAssetId} /> : null}
                  <Link className="text-link" href={buildWorkspacePagePathFromPages(crumb.id, allPages, pageRouteBasePath)}>{crumb.title}</Link>
                </span>
                {index + 1 < breadcrumbs.length ? <span className="breadcrumb-separator" aria-hidden="true">/</span> : null}
              </span>
            )) : <Link className="text-link" href={pageRouteBasePath}>Workspace</Link>}
          </nav>
        </header>

        {coverAsset ? (
          <div className="cover-preview">
            <PublishMediaTrigger
              item={{ type: 'image', src: `/api/assets/${coverAsset.id}`, alt: coverAsset.filename, label: 'Page cover' }}
              className="cover-preview-media"
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
            </PublishMediaTrigger>
          </div>
        ) : null}

        <div className={`document-content ${coverAsset ? 'has-cover' : ''}`}>
          <div className={`page-identity ${page.icon || page.iconAssetId ? 'has-icon' : ''}`}>
            <div className="page-title-row">
              {page.icon || page.iconAssetId ? (
                <div className="page-icon-wrap">
                  {page.iconAssetId ? (
                    <PublishMediaTrigger
                      item={{ type: 'image', src: `/api/assets/${page.iconAssetId}`, alt: title || 'Page icon', label: 'Page icon', caption: pageIconPromptCaption }}
                      className="page-icon page-icon-static"
                    >
                      <PageIcon icon={page.icon} iconAssetId={page.iconAssetId} />
                    </PublishMediaTrigger>
                  ) : (
                    <PublishMediaTrigger
                      item={{ type: 'emoji', symbol: page.icon || '📄', label: 'Page icon' }}
                      className="page-icon page-icon-static"
                    >
                      <PageIcon icon={page.icon} iconAssetId={page.iconAssetId} />
                    </PublishMediaTrigger>
                  )}
                </div>
              ) : null}
              <h1 className="page-title page-title-readonly">{title || 'Untitled'}</h1>
            </div>
          </div>

          {hostCollection || pageCollections.length ? (
            <section className="page-collections-embed" aria-label="Collections on this page">
              {hostCollection ? (
                <div className="page-collection-embed" aria-label={`${hostCollection.name} collection`}>
                  <p className="eyebrow">Collection</p>
                  <CollectionEditor collectionId={hostCollection.id} embedded readOnly pageRouteBasePath={pageRouteBasePath} />
                </div>
              ) : null}
              {pageCollections.map((collection) => (
                <div key={collection.id} className="page-collection-embed" aria-label={`${collection.name} collection`}>
                  <p className="eyebrow">Collection</p>
                  <CollectionEditor collectionId={collection.id} embedded focusPageId={page.id} readOnly pageRouteBasePath={pageRouteBasePath} />
                </div>
              ))}
            </section>
          ) : null}

          <div
            className="editor-view is-reading"
            tabIndex={-1}
            aria-label="Page content"
            onMouseDownCapture={onEditorViewMouseDownCapture}
            onClickCapture={onEditorViewClick}
          >
            <BlockNoteView editor={editor} slashMenu={false} editable={false} theme="dark">
            </BlockNoteView>
          </div>
        </div>
        <PublishMediaModal items={publishMediaItems} activeIndex={publishMediaIndex} onActiveIndexChange={setPublishMediaIndex} />
      </section>
    );
  }

  return (
    <section className="document-shell" aria-live="polite">
      <header className="document-topbar">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          {breadcrumbs.length > 0 ? breadcrumbs.map((crumb, index) => (
            <span key={crumb.id} className="breadcrumb-group">
              <span className="breadcrumb-entry">
                {crumb.icon || crumb.iconAssetId ? <PageIcon className="breadcrumb-icon" icon={crumb.icon} iconAssetId={crumb.iconAssetId} /> : null}
                <Link className="text-link" href={buildWorkspacePagePathFromPages(crumb.id, allPages, pageRouteBasePath)}>{crumb.title}</Link>
              </span>
              {index + 1 < breadcrumbs.length ? <span className="breadcrumb-separator" aria-hidden="true">/</span> : null}
            </span>
          )) : <Link className="text-link" href="/">Workspace</Link>}
        </nav>
        <div className="document-topbar-actions">
          {status === 'saving' ? (
            <span
              className="save-spinner"
              role="status"
              aria-label={statusMessage || 'Saving'}
              title={statusMessage || 'Saving'}
            />
          ) : null}
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
              <button type="button" disabled={isDeleted || (!page.icon && !page.iconAssetId)} onClick={() => void updateMetadata({ icon: null, iconAssetId: null })}>Remove icon</button>
              <button type="button" onClick={duplicate} disabled={isDeleted}>Duplicate</button>
              <button type="button" onClick={trash} className="danger-action">{page.deletedAt ? 'Restore' : 'Move to trash'}</button>
            </div>
          </details>
        </div>
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
        <div className={`page-identity ${page.icon || page.iconAssetId ? 'has-icon' : ''}`}>
          {!hostCollection && ((!page.icon && !page.iconAssetId) || !coverAsset) ? (
            <div className="page-media-affordances" aria-label="Page appearance">
              {!page.icon && !page.iconAssetId ? (
                <button ref={setIconTrigger} key="add-icon" type="button" aria-haspopup="dialog" aria-expanded={iconPickerOpen} disabled={isDeleted} onClick={() => { if (iconPickerOpen) { closeIconPicker('button'); return; } openIconPicker(); }}>Add icon</button>
              ) : null}
              {!coverAsset ? <>
                <button type="button" disabled={isDeleted} onClick={() => coverUploadRef.current?.click()}>Add cover</button>
                <button type="button" disabled={isDeleted} onClick={() => setCoverUrlOpen(true)}>Add cover from URL</button>
              </> : null}
            </div>
          ) : null}
          <div className="page-title-row">
            {page.icon || page.iconAssetId ? (
              <div className="page-icon-wrap">
                <button ref={setIconTrigger} key={`icon-${page.icon ?? page.iconAssetId}`} type="button" className="page-icon" aria-label="Change page icon" aria-haspopup="dialog" aria-expanded={iconPickerOpen} disabled={isDeleted} onClick={() => { if (iconPickerOpen) { closeIconPicker('button'); return; } openIconPicker(); }}><PageIcon icon={page.icon} iconAssetId={page.iconAssetId} /></button>
              </div>
            ) : null}
            <textarea className="page-title" rows={1} value={title} onChange={onTitleInput} placeholder="Untitled" disabled={isDeleted} />
          </div>
          {iconPickerOpen ? (
            <PageEmojiPicker
              pageId={pageId}
              currentIcon={page.icon}
              currentIconAssetId={page.iconAssetId}
              onSelect={selectPageIcon}
              onSelectAsset={selectPageIconAsset}
              onUploadIconFile={async (file) => {
                await uploadAndHandleTask(file, 'icon');
              }}
              onImportIconUrl={async (url) => {
                const asset = await importAssetFromUrl(url);
                selectPageIconAsset(asset.id);
                return;
              }}
              onRemove={removePageIcon}
              onClose={closeIconPicker}
              onPromptChange={setPageIconPrompt}
              style={iconPickerPosition ? { position: 'fixed', top: iconPickerPosition.top, left: iconPickerPosition.left, transform: 'none' } : undefined}
            />
          ) : null}
          {status !== 'saving' && (!hostCollection || status === 'error' || status === 'conflict') ? (
            <div className={`status ${status === 'saved' ? 'saved' : status === 'error' || status === 'conflict' ? 'error' : ''}`} role="status">
              <span>{statusMessage || 'Saved'}</span>
              {status === 'error' && hasPendingContent.current ? <button type="button" className="mini-btn" onClick={() => void savePage()}>Retry save</button> : null}
            </div>
          ) : null}
        </div>

        <input ref={coverUploadRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => chooseUpload(event, 'cover')} disabled={isDeleted} />
        <input ref={iconUploadRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => chooseUpload(event, 'icon')} disabled={isDeleted} />
        <input ref={bodyUploadRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown" multiple onChange={(event) => chooseUpload(event, 'body')} disabled={isDeleted} />

        {coverUrlOpen ? (
          <ImageGrabberPopup
            title="Add cover"
            className="image-grabber-popup cover-grabber-panel"
            onClose={() => { setCoverUrl(''); setCoverUrlOpen(false); }}
            info={(
              <ImagePopupSection title="Paste or upload" description="Paste a link, paste an image, or upload from disk." editorOnly>
                <ImageGrabberPanel
                  title="Cover image"
                  className="image-grabber-panel"
                  onPaste={(event) => {
                    const { text, imageFile } = extractGrabberPaste(event);
                    if (imageFile) {
                      event.preventDefault();
                      void uploadAndHandleTask(imageFile, 'cover');
                      return;
                    }
                    if (text) {
                      const pasted = normalizeHttpUrl(text);
                      if (pasted) {
                        event.preventDefault();
                        setCoverUrl(pasted);
                      }
                    }
                  }}
                >
                  <ImageGrabberUrlForm
                    label="Image URL"
                    inputId="cover-image-url"
                    value={coverUrl}
                    submitLabel="Use image"
                    disabled={isDeleted}
                    className="image-grabber-url-form"
                    onChange={setCoverUrl}
                    onSubmit={(event) => void addCoverFromUrl(event)}
                  >
                    <button type="button" disabled={isDeleted} onClick={() => coverUploadRef.current?.click()}>Upload image</button>
                  </ImageGrabberUrlForm>
                </ImageGrabberPanel>
              </ImagePopupSection>
            )}
          />
        ) : null}

        {imageUrlOpen ? (
          <ImageGrabberPopup
            title="Add gallery image"
            className="image-grabber-popup image-url-popover"
            style={imageUrlPosition ? { top: imageUrlPosition.top, left: imageUrlPosition.left } : undefined}
            onClose={() => { setImageUrl(''); setImageUrlOpen(false); setImageUrlPosition(null); }}
            info={(
              <ImagePopupSection title="Paste or upload" description="Paste a link, paste an image, or upload from disk." editorOnly>
                <ImageGrabberPanel
                  title="Gallery image"
                  className="image-grabber-panel"
                  onPaste={(event) => {
                    const { text, imageFile } = extractGrabberPaste(event);
                    if (imageFile) {
                      event.preventDefault();
                      void uploadAndHandleTask(imageFile, 'body');
                      return;
                    }
                    if (text) {
                      const pasted = normalizeHttpUrl(text);
                      if (pasted) {
                        event.preventDefault();
                        setImageUrl(pasted);
                      }
                    }
                  }}
                >
                  <ImageGrabberUrlForm
                    label="Image URL"
                    inputId="editor-image-url"
                    value={imageUrl}
                    submitLabel="Insert gallery"
                    autoFocus
                    disabled={isDeleted}
                    className="image-grabber-url-form"
                    onChange={setImageUrl}
                    onSubmit={(event) => void addImageFromUrl(event)}
                  >
                    <button type="button" disabled={isDeleted} onClick={() => bodyUploadRef.current?.click()}>Upload image</button>
                  </ImageGrabberUrlForm>
                </ImageGrabberPanel>
              </ImagePopupSection>
            )}
          />
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

        {hostCollection || pageCollections.length ? (
          <section className="page-collections-embed" aria-label="Collections on this page">
            {hostCollection ? (
              <div className="page-collection-embed" aria-label={`${hostCollection.name} collection`}>
                <p className="eyebrow">Collection</p>
                <CollectionEditor collectionId={hostCollection.id} embedded />
              </div>
            ) : null}
            {pageCollections.map((collection) => (
              <div key={collection.id} className="page-collection-embed" aria-label={`${collection.name} collection`}>
                <p className="eyebrow">Collection</p>
                <CollectionEditor collectionId={collection.id} embedded focusPageId={page.id} />
              </div>
            ))}
          </section>
        ) : null}

        <div
          className={`editor-view ${isEditing ? 'is-editing' : 'is-reading'}`}
          onMouseDownCapture={onEditorViewMouseDownCapture}
          onClickCapture={onEditorViewClick}
          onBlur={onEditorViewBlur}
          onKeyDown={onEditorViewKeyDown}
          onPaste={onEditorViewPaste}
          onMouseMove={onEditorMouseMove}
          onMouseLeave={() => { if (!captionEditor) setImageHover(null); }}
          tabIndex={isEditing || isDeleted ? -1 : 0}
          aria-label={isEditing ? undefined : 'Page content. Click to edit.'}
        >
          <BlockNoteView editor={editor} slashMenu={false} editable={isEditing && !isDeleted} theme="dark">
            <SideMenuController sideMenu={ArcaneSideMenu} />
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
          {timeComposerOpen ? (
            <form className="time-composer" onSubmit={insertTimestamp}>
              <label htmlFor="timestamp-value">Timestamp<input id="timestamp-value" autoFocus value={timeComposerValue} onChange={(event) => { setTimeComposerValue(event.target.value); setTimeComposerError(''); }} placeholder="1:23 or 83" /></label>
              <button type="submit" className="primary-btn">Add timestamp</button>
              <button type="button" onClick={() => setTimeComposerOpen(false)}>Cancel</button>
              {timeComposerError ? <p role="alert">{timeComposerError}</p> : null}
            </form>
          ) : null}
          {imageHover && imageHover.pageId === pageId && !captionEditor ? (
            <div className="image-actions-popover" style={{ top: imageHover.top, left: imageHover.left }}>
              <ImageGrabberPromptForm
                label="Describe image edit"
                inputId="image-ai-prompt"
                value={imagePrompt}
                placeholder="Make her look sad…"
                submitLabel="Apply"
                busyLabel="…"
                busy={imagePromptBusy}
                disabled={isDeleted}
                autoFocus
                className="image-prompt-editor"
                visuallyHiddenLabel
                onChange={setImagePrompt}
                onSubmit={(event) => void applyImagePrompt(event)}
              />
              <button type="button" className="image-caption-trigger" onClick={openCaptionEditor}>{imageHover.caption ? 'Edit caption' : 'Add caption'}</button>
            </div>
          ) : null}
          {generatingImage?.pageId === pageId ? (
            <div className="image-generation-overlay" style={{ top: generatingImage.top, left: generatingImage.left, width: generatingImage.width, height: generatingImage.height }} role="status" aria-live="polite">
              <span className="image-generation-spinner" aria-hidden="true" />
              <strong>Applying your edit…</strong>
              <span>Keeping the rest of the image unchanged</span>
            </div>
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
