import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getWorkspaceAssetsDir } from './workspace';

export const ICON_VARIANT_SIZE = 64;
export const ICON_VARIANT_QUALITY = 82;
export const ICON_VARIANT_DIR = '.derivatives';

export function getAssetFilePath(asset: { id: string; filename: string }, dataDir?: string): string {
  return path.join(getWorkspaceAssetsDir(dataDir), `${asset.id}${path.extname(asset.filename)}`);
}

export function getIconVariantPath(assetId: string, dataDir?: string): string {
  return path.join(getWorkspaceAssetsDir(dataDir), ICON_VARIANT_DIR, `${assetId}-icon.webp`);
}

export async function ensureIconVariant(originalPath: string, variantPath: string): Promise<boolean> {
  if (existsSync(variantPath)) {
    return false;
  }

  mkdirSync(path.dirname(variantPath), { recursive: true });
  const tempPath = `${variantPath}.${process.pid}.${Date.now()}.tmp`;
  await sharp(originalPath, { animated: false })
    .resize(ICON_VARIANT_SIZE, ICON_VARIANT_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: ICON_VARIANT_QUALITY })
    .toFile(tempPath);

  try {
    renameSync(tempPath, variantPath);
    return true;
  } catch {
    if (!existsSync(variantPath)) {
      throw new Error('Icon derivative could not be stored.');
    }
    return false;
  }
}
