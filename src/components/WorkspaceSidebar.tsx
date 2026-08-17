"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react';
import { buildTree, type PageTreeNode } from '@/lib/pageTree';

type SidebarPage = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  icon: string | null;
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
  onCreated,
}: {
  currentPageId?: string;
  onCreated: (page?: SidebarPage) => void;
}) {
  const [pages, setPages] = useState<SidebarPage[]>([]);
  const [trashPages, setTrashPages] = useState<SidebarPage[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [health, setHealth] = useState<WorkspaceHealth | null>(null);

  const fetchPages = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pages');
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
  };

  const fetchTrashPages = async () => {
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
  };

  const fetchHealth = async () => {
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
  };

  useEffect(() => {
    const refreshPageLists = () => {
      void fetchPages();
      void fetchTrashPages();
    };
    refreshPageLists();
    void fetchHealth();
    window.addEventListener('arcane-pages-changed', refreshPageLists);
    return () => window.removeEventListener('arcane-pages-changed', refreshPageLists);
  }, []);

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
    const nodes = buildTree(
      pages
        .slice()
        .map((page) => ({
          id: page.id,
          parentId: page.parentId,
          title: page.title,
          icon: page.icon,
          sortKey: page.sortKey,
        })),
    );
    const trimmed = query.trim();
    return trimmed ? filterTreeByQuery(nodes, trimmed) : nodes;
  }, [pages, query]);

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

        return (
          <li key={item.id} className="tree-item-row">
            <div
              className={`tree-item ${isCurrent ? 'active' : ''} ${draggingId === item.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDraggingId(item.id);
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDraggingId(null);
              }}
              onDragOver={(event) => {
                if (!draggingId) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const draggingPageId = draggingId || event.dataTransfer.getData('text/plain');
                if (!draggingPageId) {
                  return;
                }
                const mode = getDropMode(event);
                void moveByDrag(draggingPageId, item.id, mode);
                setDraggingId(null);
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
                <span>{item.icon ?? '📄'}</span>
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
                  <Link href={`/page/${item.id}`} className={isCurrent ? 'text-link active' : 'text-link'}>
                    {fullPage.title || 'Untitled'}
                  </Link>
                )}
              </div>

              <div className="tree-actions">
                <button type="button" className="mini-btn" onClick={() => {
                  setEditingId(item.id);
                  setEditingTitle(fullPage.title || 'Untitled');
                }}>
                  Rename
                </button>
                <button type="button" className="mini-btn" onClick={() => moveWithinSibling(item.id, 'up')}>
                  Up
                </button>
                <button type="button" className="mini-btn" onClick={() => moveWithinSibling(item.id, 'down')}>
                  Down
                </button>
                <button type="button" className="mini-btn" onClick={() => duplicatePage(item.id)}>
                  Duplicate
                </button>
                <label className="nest-select-label" htmlFor={`move-${item.id}`}>
                  Parent:
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
    <aside className="sidebar">
      <h1>Arcane Codex</h1>

      <nav className="sidebar-nav" aria-label="Collections and content">
        <Link href="/">Workspace</Link>
        <Link href="/collections">Collections</Link>
        <form action="/api/export" method="post">
          <button type="submit">Export ZIP</button>
        </form>
      </nav>

      {health && health.status !== 'ok' ? (
        <section className={`health-notice ${health.status}`} role={health.status === 'error' ? 'alert' : 'status'}>
          <strong>{health.status === 'error' ? 'Workspace needs recovery' : 'Workspace check found issues'}</strong>
          <span>{health.issues[0]}</span>
          {health.recovery[0] ? <span>{health.recovery[0]}</span> : null}
          <button type="button" onClick={() => void fetchHealth()}>Run check again</button>
        </section>
      ) : null}

      <div className="sidebar-section">
        <form onSubmit={onSearchSubmit} className="grid" role="search">
          <input
            value={query}
            placeholder={SEARCH_PLACEHOLDER}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search pages"
          />
        </form>
        <div className="toolbar">
          <button type="button" onClick={() => onCreatePage(null)}>
            New page
          </button>
          <button type="button" disabled={!currentPageId} onClick={() => onCreatePage(currentPageId ?? null)}>
            New child page
          </button>
        </div>
      </div>

      <div className="workspace-title">Pages</div>

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

      {trashPages.length ? (
        <section className="trash-section" aria-labelledby="trash-title">
          <div className="workspace-title" id="trash-title">Trash</div>
          <ul className="trash-list">
            {trashPages.map((trashPage) => (
              <li key={trashPage.id}>
                <span>{trashPage.icon ?? '📄'} {trashPage.title || 'Untitled'}</span>
                <button type="button" className="mini-btn" onClick={() => void restoreTrashPage(trashPage.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status && pages.length ? <p className="help status-note">{status}</p> : null}
    </aside>
  );
}
