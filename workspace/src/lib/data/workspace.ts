import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const XDG_DATA_HOME = process.env.XDG_DATA_HOME
  ? path.resolve(process.env.XDG_DATA_HOME)
  : path.join(os.homedir(), '.local', 'share');

function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME
    ? path.resolve(process.env.XDG_DATA_HOME)
    : path.join(os.homedir(), '.local', 'share');
}

export const WORKSPACE_DIRNAME = 'arcane-codex';

export function getWorkspaceBaseDir(overrideDir?: string): string {
  const base = overrideDir ?? process.env.ARCANE_DATA_DIR ?? getXdgDataHome();
  return path.join(path.resolve(base), WORKSPACE_DIRNAME);
}

export function getWorkspaceAssetsDir(overrideDir?: string): string {
  return path.join(getWorkspaceBaseDir(overrideDir), 'assets');
}

export function getWorkspaceTrashDir(overrideDir?: string): string {
  return path.join(getWorkspaceBaseDir(overrideDir), 'trash');
}

export function getWorkspaceDbPath(overrideDir?: string): string {
  return path.join(getWorkspaceBaseDir(overrideDir), 'workspace.sqlite');
}

export function ensureWorkspaceDirs(baseDir?: string): string {
  const base = getWorkspaceBaseDir(baseDir);
  const assetsDir = getWorkspaceAssetsDir(baseDir);
  const trashDir = getWorkspaceTrashDir(baseDir);
  mkdirSync(base, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(trashDir, { recursive: true });
  return base;
}

export function loadFirstRunSeed(): string | null {
  // intentionally no personal seed. Keep this hook for future optional seeds.
  return null;
}
