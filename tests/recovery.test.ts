import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createAsset,
  createPage,
  createStorageConnection,
  inspectWorkspaceHealth,
  openWorkspace,
} from '../src/lib/data/storage';
import {
  ensureWorkspaceDirs,
  getWorkspaceAssetsDir,
  getWorkspaceDbPath,
} from '../src/lib/data/workspace';

describe('workspace recovery checks', () => {
  it('reports missing assets, unregistered files, and malformed JSON with recovery guidance', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-health-'));
    ensureWorkspaceDirs(workspace);

    try {
      openWorkspace({ dataDir: workspace });
      const source = path.join(workspace, 'source.txt');
      writeFileSync(source, 'recoverable asset');
      const { asset } = createAsset({ filename: 'notes.txt', mimeType: 'text/plain', sourcePath: source }, workspace);
      const page = createPage({ title: 'Damaged draft' }, workspace);

      const db = createStorageConnection(workspace);
      db.prepare('UPDATE pages SET content_json = ? WHERE id = ?').run('{broken', page.id);
      db.close();

      const storedAsset = path.join(getWorkspaceAssetsDir(workspace), `${asset.id}.txt`);
      assert.equal(existsSync(storedAsset), true);
      unlinkSync(storedAsset);
      writeFileSync(path.join(getWorkspaceAssetsDir(workspace), 'orphan.txt'), 'unknown');

      const health = inspectWorkspaceHealth(workspace);
      assert.equal(health.status, 'degraded');
      assert.ok(health.issues.some((issue) => issue.includes('Asset file is missing')));
      assert.ok(health.issues.some((issue) => issue.includes('Unregistered file')));
      assert.ok(health.issues.some((issue) => issue.includes('invalid content JSON')));
      assert.ok(health.recovery.length >= 2);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('returns an error report instead of exposing a corrupt SQLite failure', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-corrupt-'));
    ensureWorkspaceDirs(workspace);
    writeFileSync(getWorkspaceDbPath(workspace), 'not a sqlite database');

    try {
      const health = inspectWorkspaceHealth(workspace);
      assert.equal(health.status, 'error');
      assert.ok(health.issues.length > 0);
      assert.match(health.recovery.join(' '), /copy the workspace directory/i);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
