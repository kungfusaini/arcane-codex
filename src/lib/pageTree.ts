export type PageSummary = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  sortKey: number;
};

export type PageTreeNode = PageSummary & {
  children: PageTreeNode[];
  depth: number;
};

export function buildBreadcrumbMap(pages: PageSummary[]): Map<string, PageSummary> {
  return new Map(pages.map((page) => [page.id, page]));
}

export function getBreadcrumbs(pageMap: Map<string, PageSummary>, pageId: string | null | undefined): PageSummary[] {
  const chain: PageSummary[] = [];
  let currentId = pageId;
  const seen = new Set<string>();

  while (currentId) {
    const current = pageMap.get(currentId);
    if (!current || seen.has(current.id)) {
      break;
    }
    chain.push(current);
    seen.add(current.id);
    currentId = current.parentId;
  }

  return chain.reverse();
}

export function buildTree(pages: PageSummary[]): PageTreeNode[] {
  const map = new Map<string | null, PageSummary[]>();
  for (const page of pages) {
    const bucket = map.get(page.parentId) ?? [];
    map.set(page.parentId, [...bucket, page]);
  }

  for (const list of map.values()) {
    list.sort((a, b) => (a.sortKey - b.sortKey) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }

  const visited = new Set<string>();

  const visit = (id: string | null, depth: number): PageTreeNode[] => {
    const pagesHere = map.get(id) ?? [];
    return pagesHere.flatMap((page) => {
      if (visited.has(page.id)) {
        return [];
      }
      visited.add(page.id);
      const children = visit(page.id, depth + 1);
      return [{
        ...page,
        children,
        depth,
      }];
    });
  };

  return visit(null, 0);
}

export function flattenTree(nodes: PageTreeNode[]): PageTreeNode[] {
  const out: PageTreeNode[] = [];
  const walk = (item: PageTreeNode): void => {
    out.push(item);
    for (const child of item.children) {
      walk(child);
    }
  };
  nodes.forEach(walk);
  return out;
}

export function normalizeSortKeys(items: PageSummary[]): PageSummary[] {
  return items
    .slice()
    .sort((a, b) => (a.sortKey - b.sortKey) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    .map((item, index) => ({
      ...item,
      sortKey: index + 1,
    }));
}
