import { NextRequest, NextResponse } from 'next/server';
import { exportWorkspaceZip } from '@/lib/data/export';
import { isPublishedAppSurface } from '@/lib/surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const requestedMode = new URL(request.url).searchParams.get('mode');
    const mode = isPublishedAppSurface() || requestedMode === 'published' ? 'published' : 'workspace';
    const exported = await exportWorkspaceZip(process.env.ARCANE_DATA_DIR, mode);
    return new NextResponse(exported.buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${exported.filename}"`,
        'Cache-Control': 'no-store',
        'X-Arcane-Export-Warnings': String(exported.manifest.warnings.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed';
    return NextResponse.json(
      {
        error: 'Workspace export could not be created.',
        detail: message,
        recovery: 'Run the workspace health check, repair any reported data issue, and retry.',
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST to download export ZIP.' }, { status: 405 });
}
