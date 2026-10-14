import { NextResponse } from 'next/server';

export type AppSurface = 'editor' | 'published';
export type FeatureSurface = 'editor-only' | 'published-only' | 'shared';
export type WorkspaceMode = 'editor' | 'published';

export function getAppSurface(): AppSurface {
  return process.env.ARCANE_APP_SURFACE === 'published' ? 'published' : 'editor';
}

export function isPublishedAppSurface(): boolean {
  return getAppSurface() === 'published';
}

export function isEditorAppSurface(): boolean {
  return !isPublishedAppSurface();
}

export function getWorkspaceMode(publishedMode: boolean): WorkspaceMode {
  return isPublishedAppSurface() || publishedMode ? 'published' : 'editor';
}

export function featureVisibleOnSurface(featureSurface: FeatureSurface, appSurface: AppSurface = getAppSurface()): boolean {
  if (featureSurface === 'shared') {
    return true;
  }
  if (featureSurface === 'editor-only') {
    return appSurface === 'editor';
  }
  return appSurface === 'published';
}

export function rejectPublishedMutation(action: string): NextResponse | null {
  if (isPublishedAppSurface()) {
    return NextResponse.json({ error: `${action} is not available on the published site.` }, { status: 403 });
  }
  return null;
}
