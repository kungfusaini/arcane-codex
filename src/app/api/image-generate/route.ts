import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createAsset, type AssetCreateResult } from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';

const execFileAsync = promisify(execFile);
export const runtime = 'nodejs';
export const maxDuration = 600;

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

export async function POST(request: Request) {
  const blocked = rejectPublishedMutation('Generating images');
  if (blocked) return blocked;
  let temp = '';
  try {
    const body = await request.json() as { prompt?: string; filename?: string };
    const requested = body.prompt?.trim();
    if (!requested) return NextResponse.json({ error: 'Describe the image first.' }, { status: 400 });
    if (requested.length > 1000) return NextResponse.json({ error: 'Keep the image prompt under 1000 characters.' }, { status: 400 });

    temp = await mkdtemp(join(tmpdir(), 'arcane-image-generate-'));
    const outputPath = join(temp, 'image.png');
    const guardedPrompt = `${requested}\n\nOutput requirement: produce a useful image for a private writing/workspace document. No text unless explicitly requested.`;

    await execFileAsync('codex-imagegen', ['generate', '--prompt', guardedPrompt, '--out', outputPath, '--background', 'opaque', '--size', '1024x1024', '--quality', 'medium', '--force'], {
      timeout: 10 * 60 * 1000,
      env: { ...process.env, CODEX_IMAGEGEN_CODEX_VERSION: process.env.CODEX_IMAGEGEN_CODEX_VERSION || '0.200.0' },
    });

    if (!existsSync(outputPath)) {
      return NextResponse.json({ error: 'Image generation finished without an image.' }, { status: 500 });
    }

    const created: AssetCreateResult = createAsset({
      filename: body.filename?.trim() || 'generated-image.png',
      mimeType: 'image/png',
      sourcePath: outputPath,
      width: null,
      height: null,
      prompt: requested,
    }, getDataDir());

    return NextResponse.json({ asset: created.asset, url: `/api/assets/${created.asset.id}` }, { status: created.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image generation failed.';
    return NextResponse.json({
      error: message.includes('ENOENT') ? 'codex-imagegen is not installed or is not on PATH.' : message,
    }, { status: 500 });
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
