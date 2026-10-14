import { NextResponse } from 'next/server';
import { inspectWorkspaceHealth } from '@/lib/data/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = inspectWorkspaceHealth(process.env.ARCANE_DATA_DIR);
  return NextResponse.json(health, {
    status: health.status === 'error' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
