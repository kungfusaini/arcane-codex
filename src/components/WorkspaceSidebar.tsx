"use client";

import Link from 'next/link';
import { PageIcon } from '@/components/PageIcon';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { buildTree, type PageTreeNode } from '@/lib/pageTree';
import { useDismissibleDetails } from '@/components/useDismissibleDetails';
import { WORKSPACE_HOME_SLUG, buildWorkspacePagePathFromPages, promoteWorkspaceHomeChildren } from '@/lib/workspaceHome';

type SidebarPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  slug?: string | null;
  icon: string | null;
  iconAssetId: string | null;
  revision: number;
};

type SidebarPayload = {
  pages: SidebarPage[];
};

type WorkspaceHealth = {
  status: 'ok' | 'degraded' | 'error';
  issues: string[];
  recovery: string[];
};

type SidebarTreeNode = PageTreeNode & {
  revision?: number;
};

type ReorderMove = {
  id: string;
  parentId: string | null;
  sortKey: number;
  revision: number;
};

type DropMode = 'before' | 'after' | 'into';

const SEARCH_PLACEHOLDER = 'Search pages';

function getAllPagesForParent(options: SidebarPage[], parentId: string | null): SidebarPage[] {
  return options
    .filter((page) => page.parentId === parentId)
    .slice()
    .sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function getDescendantIds(nodeId: string, childrenByParent: Map<string | null, SidebarPage[]>): Set<string> {
  const found = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop();
    if (!current || found.has(current)) {
      continue;
    }
    found.add(current);
    const direct = childrenByParent.get(current) ?? [];
    for (const child of direct) {
      stack.push(child.id);
    }
  }
  found.delete(nodeId);
  return found;
}

function filterTreeByQuery(nodes: PageTreeNode[], query: string): PageTreeNode[] {
  const lower = query.toLowerCase();
  const visit = (node: PageTreeNode): PageTreeNode | null => {
    const filteredChildren = node.children
      .map((child) => visit(child))
      .filter((child): child is PageTreeNode => Boolean(child));
    const matches = node.title.toLowerCase().includes(lower);
    if (!matches && filteredChildren.length === 0) {
      return null;
    }

    return {
      ...node,
      children: matches ? node.children : filteredChildren,
    };
  };

  return nodes
    .map((node) => visit(node))
    .filter((node): node is PageTreeNode => Boolean(node));
}

function addRevisionToTree(nodes: PageTreeNode[], pagesMap: Map<string, SidebarPage>): SidebarTreeNode[] {
  return nodes.map((node) => {
    const page = pagesMap.get(node.id);
    return {
      ...node,
      revision: page?.revision,
      children: addRevisionToTree(node.children, pagesMap),
    };
  });
}

export function WorkspaceSidebar({
  currentPageId,
  initialPages = [],
  onCreated,
  readOnly = false,
  pageRouteBasePath = '/',
  homePath = '/',
  collectionHomePath = '/collections',
  previewPublished = false,
  canTogglePreview = false,
  onPreviewPublishedChange,
  hiddenRootPageSlug = WORKSPACE_HOME_SLUG,
}: {
  currentPageId?: string;
  initialPages?: SidebarPage[];
  onCreated?: (page?: SidebarPage) => void;
  readOnly?: boolean;
  pageRouteBasePath?: string;
  homePath?: string;
  collectionHomePath?: string;
  previewPublished?: boolean;
  canTogglePreview?: boolean;
  onPreviewPublishedChange?: (nextPreviewPublished: boolean) => void;
  hiddenRootPageSlug?: string | null;
}) {
  useDismissibleDetails('.tree-menu');

  const [pages, setPages] = useState<SidebarPage[]>(initialPages);
  const [trashPages, setTrashPages] = useState<SidebarPage[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setLoading] = useState(initialPages.length === 0);
  const [status, setStatus] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [dragTargetMode, setDragTargetMode] = useState<DropMode | null>(null);
  const [recentPageId, setRecentPageId] = useState<string | null>(null);
  const [health, setHealth] = useState<WorkspaceHealth | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const focusSearchOnOpenRef = useRef(false);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pages?includeCollectionPages=false');
      if (!response.ok) {
        throw new Error('Workspace pages could not be loaded.');
      }
      const payload = (await response.json()) as SidebarPayload;
      setPages(payload.pages);
      setStatus('');
    } catch (error) {
      setPages([]);
      setStatus(error instanceof Error ? error.message : 'Workspace pages could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTrashPages = useCallback(async () => {
    try {
      const response = await fetch('/api/pages?includeDeleted=true');
      if (!response.ok) {
        throw new Error('Trash could not be loaded.');
      }
      const payload = (await response.json()) as SidebarPayload;
      setTrashPages(payload.pages);
    } catch {
      setStatus('Trash could not be loaded.');
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const payload = (await response.json()) as WorkspaceHealth;
      setHealth(payload);
    } catch {
      setHealth({
        status: 'error',
        issues: ['Workspace health check could not run.'],
        recovery: ['Keep the app stopped before copying or repairing workspace files.'],
      });
    }
  }, []);

  useEffect(() => {
    const storedRailState = window.localStorage.getItem('arcane-sidebar-collapsed');
    if (storedRailState === 'true') {
      setRailCollapsed(true);
      document.documentElement.style.setProperty('--rail-width', '0px');
    }

    const refreshPageLists = () => {
      void fetchPages();
      void fetchTrashPages();
    };
    const mobileQuery = window.matchMedia('(max-width: 64rem)');
    const updateViewport = () => {
      const nextIsMobile = mobileQuery.matches;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        setDrawerOpen(false);
      }
    };
    updateViewport();
    if (initialPages.length === 0) {
      void fetchPages();
    }
    const deferredChecks = readOnly ? null : window.setTimeout(() => {
      void fetchTrashPages();
      void fetchHealth();
    }, 300);
    mobileQuery.addEventListener('change', updateViewport);
    window.addEventListener('arcane-pages-changed', refreshPageLists);
    return () => {
      if (deferredChecks !== null) {
        window.clearTimeout(deferredChecks);
      }
      mobileQuery.removeEventListener('change', updateViewport);
      window.removeEventListener('arcane-pages-changed', refreshPageLists);
    };
  }, [fetchHealth, fetchPages, fetchTrashPages, initialPages.length, readOnly]);

  useEffect(() => {
    if (initialPages.length > 0) {
      setPages(initialPages);
      setLoading(false);
    }
  }, [initialPages]);

  const setDesktopRailCollapsed = useCallback((collapsed: boolean) => {
    setRailCollapsed(collapsed);
    window.localStorage.setItem('arcane-sidebar-collapsed', String(collapsed));
    document.documentElement.style.setProperty('--rail-width', collapsed ? '0px' : 'var(--rail-expanded-width)');
  }, []);

  useEffect(() => {
    if (!drawerOpen || !isMobile) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      const container = sidebarRef.current;
      if (!container) {
        return;
      }
      if (focusSearchOnOpenRef.current) {
        focusSearchOnOpenRef.current = false;
        searchRef.current?.focus();
        return;
      }
      const focusTarget = container.querySelector<HTMLAnchorElement | HTMLButtonElement>('a[href], button');
      focusTarget?.focus();
    }, 120);

    return () => {
      clearTimeout(focusTimer);
    };
  }, [drawerOpen, isMobile]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isMobile && !drawerOpen) {
          focusSearchOnOpenRef.current = true;
          setDrawerOpen(true);
        } else if (!isMobile && railCollapsed) {
          setDesktopRailCollapsed(false);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        } else {
          searchRef.current?.focus();
        }
        return;
      }

      if (event.key !== 'Escape') {
        return;
      }

      if (drawerOpen) {
        setDrawerOpen(false);
        navToggleRef.current?.focus();
      } else if (document.activeElement === searchRef.current && query) {
        setQuery('');
      }
    };

    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [drawerOpen, isMobile, query, railCollapsed, setDesktopRailCollapsed]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, SidebarPage[]>();
    for (const page of pages) {
      const bucket = map.get(page.parentId) ?? [];
      bucket.push(page);
      map.set(page.parentId, bucket);
    }
    return map;
  }, [pages]);

  const pageById = useMemo(() => {
    const map = new Map<string, SidebarPage>();
    for (const page of pages) {
      map.set(page.id, page);
    }
    return map;
  }, [pages]);

  const baseTree = useMemo(() => {
    const visiblePages = hiddenRootPageSlug ? promoteWorkspaceHomeChildren(pages, hiddenRootPageSlug) : pages;
    const nodes = buildTree(
      visiblePages
        .slice()
        .map((page) => ({
          id: page.id,
          parentId: page.parentId,
          title: page.title,
          icon: page.icon,
          iconAssetId: page.iconAssetId,
          sortKey: page.sortKey,
        })),
    );
    const trimmed = query.trim();
    return trimmed ? filterTreeByQuery(nodes, trimmed) : nodes;
  }, [hiddenRootPageSlug, pages, query]);

  const tree = useMemo(() => addRevisionToTree(baseTree, pageById), [baseTree, pageById]);

  const reorderSiblings = async (moves: ReorderMove[]) => {
    const response = await fetch('/api/pages/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moves }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `Reorder failed (${response.status})`);
    }

    await fetchPages();
  };

  const movePage = async (pageId: string, parentId: string | null) => {
    const page = pageById.get(pageId);
    if (!page) {
      return;
    }

    const siblings = getAllPagesForParent(pages, parentId);
    const moves: ReorderMove[] = [
      {
        id: pageId,
        parentId,
        sortKey: siblings.length + 1,
        revision: page.revision,
      },
    ];

    await reorderSiblings(moves);
  };

  const moveWithinSibling = async (pageId: string, direction: 'up' | 'down') => {
    const page = pageById.get(pageId);
    if (!page) {
      return;
    }

    const siblings = getAllPagesForParent(pages, page.parentId);
    const sorted = siblings.slice().sort((a, b) => a.sortKey - b.sortKey);
    const index = sorted.findIndex((item) => item.id === page.id);
    if (index < 0) {
      return;
    }

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= sorted.length) {
      return;
    }

    const copy = [...sorted];
    [copy[index], copy[target]] = [copy[target], copy[index]];

    const moves: ReorderMove[] = copy.map((item, idx) => ({
      id: item.id,
      parentId: item.parentId,
      sortKey: idx + 1,
      revision: item.revision,
    }));

    try {
      await reorderSiblings(moves);
      setStatus('Reordered pages');
      setTimeout(() => setStatus(''), 1200);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const getDropMode = (event: DragEvent<HTMLDivElement>): DropMode => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = event.clientY - rect.top;
    const ratio = pointer / rect.height;

    if (ratio < 0.33) {
      return 'before';
    }
    if (ratio > 0.67) {
      return 'after';
    }
    return 'into';
  };

  const moveByDrag = async (sourceId: string, targetId: string, mode: DropMode) => {
    const source = pageById.get(sourceId);
    const target = pageById.get(targetId);
    if (!source || !target) {
      return;
    }

    if (sourceId === targetId) {
      setStatus('Move skipped: same source and target');
      setTimeout(() => setStatus(''), 1000);
      return;
    }

    const descendants = getDescendantIds(sourceId, childrenByParent);
    if (mode === 'into' && descendants.has(targetId)) {
      setStatus('Move blocked: cannot move page into its own descendant');
      return;
    }

    if (mode !== 'into' && target.parentId && descendants.has(target.parentId)) {
      setStatus('Move blocked: would create a cycle');
      return;
    }

    let moves: ReorderMove[] = [];

    if (mode === 'into') {
      if (source.parentId === targetId) {
        return;
      }
      const children = getAllPagesForParent(pages, targetId);
      moves = [
        {
          id: source.id,
          parentId: targetId,
          sortKey: children.length + 1,
          revision: source.revision,
        },
      ];
    } else {
      const targetParentId = target.parentId;
      const siblings = getAllPagesForParent(pages, targetParentId).filter((item) => item.id !== sourceId);
      const targetIndex = siblings.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) {
        return;
      }

      const insertAt = mode === 'before' ? targetIndex : targetIndex + 1;
      const ordered = [...siblings];
      ordered.splice(insertAt, 0, { ...source, parentId: targetParentId });

      moves = ordered.map((item, idx) => ({
        id: item.id,
        parentId: targetParentId,
        sortKey: idx + 1,
        revision: item.revision,
      }));
    }

    try {
      await reorderSiblings(moves);
      setStatus('Moved page');
      setTimeout(() => setStatus(''), 1000);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const onCreatePage = async (parentId: string | null = null) => {
    if (readOnly || !onCreated) {
      return;
    }
    try {
      const response = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', parentId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { page?: SidebarPage; error?: string };
      if (!response.ok || !payload.page) {
        throw new Error(payload.error || 'Page could not be created.');
      }
      await fetchPages();
      onCreated(payload.page);
      setRecentPageId(payload.page.id);
      window.setTimeout(() => {
        setRecentPageId((current) => (current === payload.page?.id ? null : current));
      }, 800);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Page could not be created.');
    }
  };

  const restoreTrashPage = async (pageId: string) => {
    const response = await fetch(`/api/pages/${pageId}/restore`, { method: 'POST' });
    if (!response.ok) {
      setStatus('Page could not be restored.');
      return;
    }
    await Promise.all([fetchPages(), fetchTrashPages()]);
    if (currentPageId === pageId) {
      window.location.reload();
      return;
    }
    setStatus('Page restored');
    setTimeout(() => setStatus(''), 1200);
  };

  const duplicatePage = async (pageId: string) => {
    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate' }),
    });
    if (!response.ok) {
      return;
    }
    await response.json();
    await fetchPages();
  };

  const renamePage = async (pageId: string) => {
    const page = pageById.get(pageId);
    if (!page) {
      setEditingId(null);
      return;
    }

    const title = editingTitle.trim() || 'Untitled';
    if (title === page.title) {
      setEditingId(null);
      return;
    }

    const response = await fetch(`/api/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: page.revision, title }),
    });

    if (response.ok) {
      await fetchPages();
      setEditingId(null);
      setStatus('Renamed page');
      setTimeout(() => setStatus(''), 1200);
      return;
    }

    if (response.status === 409) {
      setStatus('Unable to rename: revision stale. Please retry.');
      return;
    }
    setStatus('Rename failed');
  };

  const renderRows = (items: SidebarTreeNode[]) => {
    const rows = items
      .map((item) => {
        const fullPage = pageById.get(item.id);
        if (!fullPage) {
          return null;
        }

        const isCollapsed = collapsedNodes.has(item.id);
        const hasChildren = item.children.length > 0;
        const isCurrent = currentPageId === item.id;
        const childrenIds = getDescendantIds(item.id, childrenByParent);
        const potentialParents = pages.filter((page) => {
          if (page.id === item.id) {
            return false;
          }
          return !childrenIds.has(page.id);
        });

        const moveTarget = item.parentId ?? '';
        const isDropTarget = dragTargetId === item.id;
        const moveModeClass = dragTargetMode === 'before' ? 'tree-item-drop-before' : dragTargetMode === 'after' ? 'tree-item-drop-after' : dragTargetMode === 'into' ? 'tree-item-drop-into' : '';

        return (
          <li key={item.id} className="tree-item-row">
            <div
              className={`tree-item ${isCurrent ? 'active' : ''} ${draggingId === item.id ? 'dragging' : ''} ${isDropTarget ? `tree-item-drop ${moveModeClass}` : ''} ${recentPageId === item.id ? 'tree-item-new' : ''}`}
              draggable={!readOnly}
              onDragStart={readOnly ? undefined : (event) => {
                setDraggingId(item.id);
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={readOnly ? undefined : () => {
                setDraggingId(null);
                setDragTargetId(null);
                setDragTargetMode(null);
              }}
              onDragEnter={readOnly ? undefined : (event) => {
                if (!draggingId) {
                  return;
                }
                const mode = getDropMode(event);
                setDragTargetId(item.id);
                setDragTargetMode(mode);
              }}
              onDragOver={readOnly ? undefined : (event) => {
                if (!draggingId) {
                  return;
                }
                event.preventDefault();
                const mode = getDropMode(event);
                setDragTargetId(item.id);
                setDragTargetMode(mode);
                event.dataTransfer.dropEffect = 'move';
              }}
              onDragLeave={readOnly ? undefined : () => {
                if (isDropTarget) {
                  setDragTargetId(null);
                  setDragTargetMode(null);
                }
              }}
              onDrop={readOnly ? undefined : (event) => {
                event.preventDefault();
                const draggingPageId = draggingId || event.dataTransfer.getData('text/plain');
                const mode = dragTargetMode || getDropMode(event);
                if (!draggingPageId) {
                  setDragTargetId(null);
                  setDragTargetMode(null);
                  return;
                }
                void moveByDrag(draggingPageId, item.id, mode);
                setDraggingId(null);
                setDragTargetId(null);
                setDragTargetMode(null);
              }}
            >
              <div className="tree-title-wrap">
                {hasChildren ? (
                  <button
                    type="button"
                    className="tree-toggle"
                    onClick={() => {
                      const next = new Set(collapsedNodes);
                      if (next.has(item.id)) {
                        next.delete(item.id);
                      } else {
                        next.add(item.id);
                      }
                      setCollapsedNodes(next);
                    }}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${item.title}`}
                  >
                    {isCollapsed ? '+' : '−'}
                  </button>
                ) : (
                  <span className="tree-spacer">•</span>
                )}
                <PageIcon icon={item.icon} iconAssetId={item.iconAssetId} />
                {editingId === item.id ? (
                  <input
                    value={editingTitle}
                    className="tree-inline-input"
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onBlur={() => renamePage(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void renamePage(item.id);
                      } else if (event.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                    autoFocus
                    aria-label={`Rename ${item.title}`}
                  />
                ) : (
                  <Link
                    href={buildWorkspacePagePathFromPages(item.id, pages, pageRouteBasePath)}
                    className={isCurrent ? 'text-link active' : 'text-link'}
                    title={fullPage.title || 'Untitled'}
                  >
                    {fullPage.title || 'Untitled'}
                  </Link>
                )}
              </div>

              {readOnly ? null : (
                <details className="tree-menu">
                  <summary aria-label={`Actions for ${item.title}`}>•••</summary>
                  <div className="tree-actions">
                    <button type="button" className="mini-btn" onClick={() => {
                      setEditingId(item.id);
                      setEditingTitle(fullPage.title || 'Untitled');
                    }}>
                      Rename
                    </button>
                    <button type="button" className="mini-btn" onClick={() => moveWithinSibling(item.id, 'up')}>
                      Move up
                    </button>
                    <button type="button" className="mini-btn" onClick={() => moveWithinSibling(item.id, 'down')}>
                      Move down
                    </button>
                    <button type="button" className="mini-btn" onClick={() => duplicatePage(item.id)}>
                      Duplicate
                    </button>
                    <label className="nest-select-label" htmlFor={`move-${item.id}`}>
                      Parent
                      <select
                        id={`move-${item.id}`}
                        className="tree-select"
                        value={moveTarget}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          const nextParent = event.target.value || null;
                          if (nextParent === item.parentId) {
                            return;
                          }
                          void movePage(item.id, nextParent).catch((error) => {
                            setStatus((error as Error).message);
                          });
                        }}
                      >
                        <option value="">Root</option>
                        {potentialParents
                          .slice()
                          .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </details>
              )}
            </div>

            {!isCollapsed && item.children.length > 0 ? (
              <ul className="tree-level">{renderRows(item.children)}</ul>
            ) : null}
          </li>
        );
      })
      .filter((entry): entry is JSX.Element => entry !== null);

    return rows;
  };

  return (
    <>
      {!isMobile && railCollapsed ? (
        <button type="button" className="sidebar-reopen" aria-label="Open sidebar" onClick={() => setDesktopRailCollapsed(false)}><span aria-hidden="true">☰</span></button>
      ) : null}
      <header className="mobile-bar">
        <button
          ref={navToggleRef}
          type="button"
          className="nav-toggle"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="workspace-navigation"
          onClick={() => setDrawerOpen(true)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <Link href={homePath} className="mobile-brand">Arcane Codex</Link>
        {canTogglePreview ? (
          <button type="button" className="mobile-preview-toggle" aria-pressed={previewPublished} onClick={() => onPreviewPublishedChange?.(!previewPublished)}>
            {previewPublished ? 'Editor' : 'Preview'}
          </button>
        ) : readOnly || !onCreated ? null : <button type="button" className="mobile-new" onClick={() => onCreatePage(null)}>New</button>}
      </header>
      <button
        type="button"
        className={`sidebar-scrim ${drawerOpen ? 'open' : ''}`}
        aria-label="Close navigation"
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
        tabIndex={-1}
      />
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        className={`sidebar ${drawerOpen ? 'open' : ''} ${railCollapsed && !isMobile ? 'desktop-collapsed' : ''}`}
        aria-hidden={isMobile ? !drawerOpen : railCollapsed ? true : undefined}
      >
        <div className="sidebar-brand-row">
          <Link href={homePath} className="sidebar-brand" title="Arcane Codex">
            <span className="logo-content">
              <span className="site-title"><span className="arcane">ARCANE</span><span className="codex">CODEX</span></span>
              <span className="site-tagline">Compiled Texts for the Modern Mage</span>
            </span>
          </Link>
          <button type="button" className="sidebar-collapse" aria-label="Collapse sidebar" onClick={() => setDesktopRailCollapsed(true)}>‹</button>
          <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>×</button>
        </div>

        {canTogglePreview ? (
          <section className={`preview-mode-control ${previewPublished ? 'active' : ''}`} aria-label="Published preview mode">
            <div>
              <strong>{previewPublished ? 'Published preview' : 'Editor mode'}</strong>
              <span>{previewPublished ? 'Read-only view on this URL.' : 'Preview the read-only surface locally.'}</span>
            </div>
            <button type="button" className={previewPublished ? 'primary-btn' : 'quiet-btn'} aria-pressed={previewPublished} onClick={() => onPreviewPublishedChange?.(!previewPublished)}>
              {previewPublished ? 'Back to editor' : 'Preview published'}
            </button>
          </section>
        ) : null}

        {!readOnly && health && health.status !== 'ok' ? (
          <section className={`health-notice ${health.status}`} role={health.status === 'error' ? 'alert' : 'status'}>
            <strong>{health.status === 'error' ? 'Workspace needs recovery' : 'Workspace check found issues'}</strong>
            <span>{health.issues[0]}</span>
            {health.recovery[0] ? <span>{health.recovery[0]}</span> : null}
            <button type="button" onClick={() => void fetchHealth()}>Run check again</button>
          </section>
        ) : null}

        <div className="sidebar-section">
          <form onSubmit={onSearchSubmit} role="search">
            <input
              ref={searchRef}
              value={query}
              placeholder={SEARCH_PLACEHOLDER}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search pages"
            />
          </form>
          {readOnly || !onCreated ? null : (
            <div className="sidebar-create-row">
              <button type="button" className="primary-btn" onClick={() => onCreatePage(null)}>New page</button>
              <button type="button" className="icon-btn" aria-label="New child page" disabled={!currentPageId} onClick={() => onCreatePage(currentPageId ?? null)}>＋</button>
            </div>
          )}
        </div>

        <div className="workspace-title">Pages</div>
        <div className="sidebar-pages">
          {isLoading ? (
            <p className="help">Loading workspace…</p>
          ) : tree.length ? (
            <ul className="tree-level">{renderRows(tree)}</ul>
          ) : status ? (
            <div className="grid">
              <p className="help status-note">{status}</p>
              <button type="button" onClick={() => void fetchPages()}>Retry loading pages</button>
            </div>
          ) : query.trim() ? (
            <div className="grid">
              <p className="help">No pages match “{query.trim()}”.</p>
              <button type="button" onClick={() => setQuery('')}>Clear search</button>
            </div>
          ) : (
            <p className="help">No pages yet. Create one to begin.</p>
          )}
        </div>

        {!readOnly && trashPages.length ? (
          <details className="trash-section">
            <summary id="trash-title">Trash <span>{trashPages.length}</span></summary>
            <ul className="trash-list">
              {trashPages.map((trashPage) => (
                <li key={trashPage.id}>
                  <span><PageIcon icon={trashPage.icon} iconAssetId={trashPage.iconAssetId} /> {trashPage.title || 'Untitled'}</span>
                  <button type="button" className="mini-btn" onClick={() => void restoreTrashPage(trashPage.id)}>Restore</button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {!readOnly ? (
          <div className="sidebar-site-links" aria-label="Workspace sections">
            <Link href={collectionHomePath} className="sidebar-section-link">Collections</Link>
          </div>
        ) : null}

        {status && pages.length ? <p className="help status-note" role="status">{status}</p> : null}
      </aside>
    </>
  );
}
