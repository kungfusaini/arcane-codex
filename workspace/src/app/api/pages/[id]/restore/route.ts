import { NextResponse } from 'next/server';
import { getPage, restorePage } from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const blocked = rejectPublishedMutation('Restoring pages');
  if (blocked) return blocked;
  const existing = getPage(params.id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const page = restorePage(params.id);
  if (!page) {
    return NextResponse.json({ error: 'Restore failed' }, { status: 400 });
  }

  return NextResponse.json({ page });
}
