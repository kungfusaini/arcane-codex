import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { ensureIconVariant, getAssetFilePath, getIconVariantPath } from '../src/lib/data/assetDerivatives';
import { getWorkspaceDbPath } from '../src/lib/data/workspace';

type IconAssetRow = {
  id: string;
  filename: string;
  mime_type: string;
};

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

async function main() {
  const dataDir = getDataDir();
  const dbPath = getWorkspaceDbPath(dataDir);
  if (!existsSync(dbPath)) {
    throw new Error(`Workspace database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows: IconAssetRow[];
  try {
    rows = db
      .prepare(
        `SELECT DISTINCT a.id, a.filename, a.mime_type
         FROM pages p
         JOIN assets a ON a.id = p.icon_asset_id
         WHERE p.deleted_at IS NULL
           AND p.icon_asset_id IS NOT NULL
           AND a.mime_type LIKE 'image/%'
         ORDER BY a.id`,
      )
      .all() as IconAssetRow[];
  } finally {
    db.close();
  }

  let created = 0;
  let existing = 0;
  let missing = 0;
  let failed = 0;
  let totalBytes = 0;

  for (const row of rows) {
    const asset = { id: String(row.id), filename: String(row.filename) };
    const originalPath = getAssetFilePath(asset, dataDir);
    const variantPath = getIconVariantPath(asset.id, dataDir);

    if (!existsSync(originalPath)) {
      missing += 1;
      console.warn(`missing original: ${asset.id} ${asset.filename}`);
      continue;
    }

    try {
      const didCreate = await ensureIconVariant(originalPath, variantPath);
      if (didCreate) created += 1;
      else existing += 1;
      totalBytes += statSync(variantPath).size;
    } catch (error) {
      failed += 1;
      console.warn(`failed derivative: ${asset.id} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify({ icons: rows.length, created, existing, missing, failed, totalDerivativeBytes: totalBytes }, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
