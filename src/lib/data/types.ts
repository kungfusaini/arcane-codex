export type PageRecord = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  slug: string;
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

export type NewPage = {
  parentId?: string | null;
  sortKey?: number;
  title: string;
  icon?: string | null;
  iconAssetId?: string | null;
  coverAssetId?: string | null;
  coverFocalX?: number;
  coverFocalY?: number;
  coverScale?: number;
  contentJson?: string;
};

export type PageUpdate = Partial<
  Pick<PageRecord, 'parentId' | 'sortKey' | 'title' | 'icon' | 'iconAssetId' | 'coverAssetId' | 'coverFocalX' | 'coverFocalY' | 'coverScale' | 'contentJson'>
> & {
  revision: number;
};

export type PageMoveInput = {
  id: string;
  parentId: string | null;
  sortKey: number;
  revision: number;
};

export type AssetRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sha256: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: number;
};

export type PageLinkRecord = {
  sourcePageId: string;
  sourceBlockId: string;
  targetPageId: string;
};

export type CollectionPropertyType = 'text' | 'number' | 'select' | 'multi-select' | 'checkbox' | 'date' | 'url';

export type CollectionOptionColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

export type CollectionProperty = {
  id: string;
  name: string;
  type: CollectionPropertyType;
  options?: string[];
  optionColors?: Record<string, CollectionOptionColor>;
};

export type CollectionSchema = {
  properties: CollectionProperty[];
};

export type CollectionItemRecord = {
  collectionId: string;
  pageId: string;
  propertiesJson: string;
  sortKey: number;
};

export type CollectionRecord = {
  id: string;
  hostPageId: string | null;
  name: string;
  schemaJson: string;
  viewsJson: string;
  createdAt: number;
  updatedAt: number;
};

export type CollectionViewMode = 'table' | 'gallery';

export type CollectionSort = {
  propertyId: string;
  direction: 'asc' | 'desc';
};

export type CollectionFilter = {
  propertyId: string;
  query: string;
};

export type CollectionViews = {
  mode: CollectionViewMode;
  sort?: CollectionSort;
  filter?: CollectionFilter;
};

export type CollectionItemPayload = {
  collectionId: string;
  pageId: string;
  sortKey?: number;
  properties: Record<string, unknown>;
};

export type CollectionPropertiesPatch = {
  collectionId: string;
  pageId: string;
  properties: Record<string, unknown>;
};

export type CollectionUpdateItemSort = {
  collectionId: string;
  pageId: string;
  sortKey: number;
};

export type SettingsRecord = {
  schemaVersion: number;
  workspaceName: string;
  publishedMode: boolean;
  createdAt: number;
  updatedAt: number;
};

export type StorageConfig = {
  dataDir?: string;
};

export class RevisionConflictError extends Error {
  currentRevision?: number;

  constructor(message = 'Page revision conflict', currentRevision?: number) {
    super(message);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}
