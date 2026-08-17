import { NextResponse } from 'next/server';
import { exportWorkspaceZip } from '@/lib/data/export';
import { readFileSync } from 'node:fs';

export async function POST() {
  const zipPath = exportWorkspaceZip();
  const zip = readFileSync(zipPath);
  return new NextResponse(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="arcane-codex-export.zip"`,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST to download export ZIP.' }, { status: 405 });
}
