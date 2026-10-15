import { NextRequest, NextResponse } from 'next/server';
import { getPagePublication, getPublishedPage, publishPage, unpublishPage } from '@/lib/data/storage';
import { isPublishedAppSurface, rejectPublishedMutation } from '@/lib/surface';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const publication = isPublishedAppSurface() && !getPublishedPage(params.id) ? null : getPagePublication(params.id);
  return publication
    ? NextResponse.json({ publication })
    : NextResponse.json({ error: 'Page not found' }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const blocked = rejectPublishedMutation('Publishing pages');
  if (blocked) return blocked;
  const payload = await request.json().catch(() => ({})) as { action?: unknown; visibility?: unknown };
  try {
    if (payload.action === 'unpublish') {
      return NextResponse.json({ publication: unpublishPage(params.id) });
    }
    const visibility = payload.visibility === 'unlisted' ? 'unlisted' : payload.visibility === 'public' ? 'public' : null;
    if (!visibility) return NextResponse.json({ error: 'visibility must be public or unlisted' }, { status: 400 });
    const page = publishPage(params.id, visibility);
    return NextResponse.json({ publication: getPagePublication(params.id), page });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Publication update failed' }, { status: 400 });
  }
}
