export type PageRecord = {
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

export type NewPage = {
  parentId?: string | null;
  sortKey?: number;
  title: string;
  icon?: string | null;
  coverAssetId?: string | null;
  contentJson?: string;
};

export type PageUpdate = Partial<
  Pick<PageRecord, 'parentId' | 'sortKey' | 'title' | 'icon' | 'coverAssetId' | 'contentJson'>
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

export type CollectionRecord = {
  id: string;
  hostPageId: string | null;
  name: string;
  schemaJson: string;
  viewsJson: string;
  createdAt: number;
  updatedAt: number;
};

export type CollectionItemRecord = {
  collectionId: string;
  pageId: string;
  propertiesJson: string;
  sortKey: number;
};

export type SettingsRecord = {
  schemaVersion: number;
  workspaceName: string;
  createdAt: number;
  updatedAt: number;
};

export type StorageConfig = {
  dataDir?: string;
};

export class RevisionConflictError extends Error {
  constructor(message = 'Page revision conflict') {
    super(message);
    this.name = 'RevisionConflictError';
  }
}
