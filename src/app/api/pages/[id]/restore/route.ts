import { NextResponse } from 'next/server';
import { getPage, restorePage } from '@/lib/data/storage';

export async function POST(_: Request, { params }: { params: { id: string } }) {
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
