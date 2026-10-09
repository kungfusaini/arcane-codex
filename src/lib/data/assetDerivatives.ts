import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getWorkspaceAssetsDir } from './workspace';

export type AssetImageVariant = 'icon' | 'page-icon';

const IMAGE_VARIANTS: Record<AssetImageVariant, { size: number; quality: number; suffix: string }> = {
  icon: { size: 64, quality: 82, suffix: 'icon' },
  'page-icon': { size: 192, quality: 86, suffix: 'page-icon' },
};

export const ICON_VARIANT_DIR = '.derivatives';

export function getAssetFilePath(asset: { id: string; filename: string }, dataDir?: string): string {
  return path.join(getWorkspaceAssetsDir(dataDir), `${asset.id}${path.extname(asset.filename)}`);
}

export function getImageVariantConfig(variant: AssetImageVariant) {
  return IMAGE_VARIANTS[variant];
}

export function getIconVariantPath(assetId: string, dataDir?: string, variant: AssetImageVariant = 'icon'): string {
  return path.join(getWorkspaceAssetsDir(dataDir), ICON_VARIANT_DIR, `${assetId}-${IMAGE_VARIANTS[variant].suffix}.webp`);
}

export async function ensureIconVariant(originalPath: string, variantPath: string, variant: AssetImageVariant = 'icon'): Promise<boolean> {
  if (existsSync(variantPath)) {
    return false;
  }

  const config = IMAGE_VARIANTS[variant];
  mkdirSync(path.dirname(variantPath), { recursive: true });
  const tempPath = `${variantPath}.${process.pid}.${Date.now()}.tmp`;
  await sharp(originalPath, { animated: false })
    .resize(config.size, config.size, { fit: 'cover', position: 'centre' })
    .webp({ quality: config.quality })
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
