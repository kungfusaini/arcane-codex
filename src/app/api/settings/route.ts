import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/data/storage';

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function PATCH(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const workspaceName = typeof payload.workspaceName === 'string' ? payload.workspaceName : undefined;
  const publishedMode = typeof payload.publishedMode === 'boolean' ? payload.publishedMode : undefined;

  if (workspaceName === undefined && publishedMode === undefined) {
    return NextResponse.json({ error: 'No settings provided.' }, { status: 400 });
  }

  const settings = updateSettings(undefined, { workspaceName, publishedMode });
  return NextResponse.json({ settings });
}
