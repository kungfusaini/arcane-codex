import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

import { ensureWorkspaceDirs, getWorkspaceAssetsDir } from '../src/lib/data/workspace';
import { createAsset, createPage, getAssetPathFromId, listAssets, updatePage } from '../src/lib/data/storage';
import { POST, GET } from '../src/app/api/assets/route';

function createTempWorkspace(): string {
  const base = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-'));
  ensureWorkspaceDirs(base);
  return base;
}

describe('asset storage', () => {
  it('uses hash ids and deduplicates uploads by content', () => {
    const workspace = createTempWorkspace();

    const sourceFile = path.join(workspace, 'upload.txt');
    writeFileSync(sourceFile, 'identical payload');

    const first = createAsset(
      {
        filename: 'attachment.txt',
        mimeType: 'text/plain',
        sourcePath: sourceFile,
      },
      workspace,
    );

    const second = createAsset(
      {
        filename: 'different-filename.txt',
        mimeType: 'text/plain',
        sourcePath: sourceFile,
      },
      workspace,
    );

    assert.equal(first.created, true, 'first upload should create');
    assert.equal(second.created, false, 'second upload should reuse existing by hash');
    assert.equal(first.asset.id, second.asset.id, 'stable hash id expected');
    assert.equal(first.asset.sha256, second.asset.sha256, 'hash metadata expected to match');
    assert.equal(first.asset.filename, 'attachment.txt');

    const list = listAssets(workspace);
    assert.equal(list.length, 1, 'duplicate upload should not create a second row');

    const assetPath = getAssetPathFromId(first.asset.id, workspace);
    assert.ok(assetPath.startsWith(getWorkspaceAssetsDir(workspace)));

    rmSync(workspace, { recursive: true, force: true });
  });
});

describe('asset upload endpoint', () => {
  it('stores supported files and rejects unsupported files', async () => {
    const workspace = createTempWorkspace();
    const oldDir = process.env.ARCANE_DATA_DIR;
    process.env.ARCANE_DATA_DIR = workspace;

    const createAssetRequest = async (
      filename: string,
      mimeType: string,
      bodyText: string,
    ): Promise<Response> => {
      const formData = new FormData();
      formData.append('file', new File([bodyText], filename, { type: mimeType }));
      const request = new NextRequest('http://localhost/api/assets', {
        method: 'POST',
        body: formData,
      });
      return POST(request);
    };

    const allowedResponse = await createAssetRequest('note.md', 'text/markdown', '# hello');
    assert.equal(allowedResponse.status, 201);
    const allowedPayload = (await allowedResponse.json()) as { asset: { id: string }; created: boolean };
    assert.equal(allowedPayload.created, true);

    const disallowedResponse = await createAssetRequest('note.bin', 'application/octet-stream', 'binary');
    assert.equal(disallowedResponse.status, 400);

    const spoofedImageResponse = await createAssetRequest('fake.png', 'image/png', 'not a png');
    assert.equal(spoofedImageResponse.status, 400);
    assert.match((await spoofedImageResponse.json() as { error: string }).error, /contents do not match/i);

    const duplicateResponse = await createAssetRequest('note-two.md', 'text/markdown', '# hello');
    assert.equal(duplicateResponse.status, 200);
    const duplicatePayload = (await duplicateResponse.json()) as { asset: { id: string } };
    assert.equal(duplicatePayload.asset.id, allowedPayload.asset.id);

    const oversized = 'x'.repeat(20 * 1024 * 1024 + 1);
    const tooLargeResponse = await createAssetRequest('large.txt', 'text/plain', oversized);
    assert.equal(tooLargeResponse.status, 413);

    const listResponse = await GET();
    const payload = (await listResponse.json()) as { assets: Array<{ id: string }> };
    assert.equal(payload.assets.length, 1);

    process.env.ARCANE_DATA_DIR = oldDir;
    rmSync(workspace, { recursive: true, force: true });
  });
});

it('supports choosing uploaded asset references for page cover', async () => {
  const workspace = createTempWorkspace();
  const oldDir = process.env.ARCANE_DATA_DIR;
  process.env.ARCANE_DATA_DIR = workspace;

  const formData = new FormData();
  formData.append(
    'file',
    new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'cover.png', { type: 'image/png' }),
  );
  const uploadRequest = new NextRequest('http://localhost/api/assets', {
    method: 'POST',
    body: formData,
  });
  const uploadResponse = await POST(uploadRequest);
  const payload = (await uploadResponse.json()) as { asset: { id: string } };

  const page = createPage({ title: 'Media test' }, workspace);
  const next = updatePage(
    page.id,
    {
      revision: page.revision,
      coverAssetId: payload.asset.id,
    },
    workspace,
  );

  assert.equal(next.coverAssetId, payload.asset.id);

  process.env.ARCANE_DATA_DIR = oldDir;
  rmSync(workspace, { recursive: true, force: true });
});
