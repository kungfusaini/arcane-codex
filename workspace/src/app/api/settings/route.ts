import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function PATCH(request: NextRequest) {
  const blocked = rejectPublishedMutation('Publishing settings changes');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({}));
  const workspaceName = typeof payload.workspaceName === 'string' ? payload.workspaceName : undefined;
  const publishedMode = typeof payload.publishedMode === 'boolean' ? payload.publishedMode : undefined;

  if (workspaceName === undefined && publishedMode === undefined) {
    return NextResponse.json({ error: 'No settings provided.' }, { status: 400 });
  }

  const settings = updateSettings(undefined, { workspaceName, publishedMode });
  return NextResponse.json({ settings });
}
