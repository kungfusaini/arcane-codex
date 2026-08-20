import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createAsset, type AssetCreateResult } from '@/lib/data/storage';

const execFileAsync = promisify(execFile);
export const runtime = 'nodejs';
export const maxDuration = 600;

function getDataDir(): string | undefined {
  return process.env.ARCANE_DATA_DIR;
}

export async function POST(request: Request) {
  let temp = '';
  try {
    const body = await request.json() as { prompt?: string };
    const requested = body.prompt?.trim();
    if (!requested) return NextResponse.json({ error: 'Describe the icon first.' }, { status: 400 });
    if (requested.length > 300) return NextResponse.json({ error: 'Keep the icon prompt under 300 characters.' }, { status: 400 });

    temp = await mkdtemp(join(tmpdir(), 'arcane-page-icon-'));
    const outputPath = join(temp, 'icon.png');
    const mattePath = join(temp, 'icon-matte.png');
    const presetDir = join(process.cwd(), 'codex-imagegen', 'presets', 'emoji');
    const presetPrompt = await readFile(join(presetDir, 'prompt.md'), 'utf8');
    const guardedPrompt = `${presetPrompt}\n\nUser request:\n${requested}\n\nFinal emoji render contract: simplify adaptively without losing identity. Preserve the subject's dominant silhouette, requested color or material attributes, and only its most recognizable cues. Reduce everything else to a very small number of broad, readable forms with shallow rounded volume and generous negative space. Keep one clear focal idea and a restrained visual hierarchy. For complex subjects, collapse the design into its largest readable outer shapes and a few major colour blocks. Prefer big simple shapes over intricate construction. Reduce seams, panel lines, surface texture, joints, and micro-detail. Treat descriptive modifiers as attributes of the requested subject, not invitations to add ornament, realism, layered detail, or extra components. The result must read clearly at 32px as a polished platform emoji.\n\nOutput requirement: render against a perfectly uniform chroma-green background (#00ff00) for clean removal. No text.`;

    const styleImage = join(presetDir, 'emoji-style-reference-sheet.png');
    await execFileAsync('codex-imagegen', ['generate', '--prompt', guardedPrompt, '--out', outputPath, '--background', 'opaque', '--size', '1024x1024', '--quality', 'medium', '--force', '--style-image', styleImage], {
      timeout: 10 * 60 * 1000,
      env: { ...process.env, CODEX_IMAGEGEN_CODEX_VERSION: process.env.CODEX_IMAGEGEN_CODEX_VERSION || '0.200.0' },
    });

    if (!existsSync(outputPath)) {
      return NextResponse.json({ error: 'Icon generation finished without an image.' }, { status: 500 });
    }

    await execFileAsync('magick', [outputPath, '-alpha', 'on', '-fuzz', '35%', '-transparent', '#00ff00', '-channel', 'G', '-fx', 'a==0 ? g : min(g,max(r,b))', '+channel', mattePath], {
      timeout: 30 * 1000,
    });

    const created: AssetCreateResult = createAsset({
      filename: 'generated-page-icon.png',
      mimeType: 'image/png',
      sourcePath: mattePath,
      width: null,
      height: null,
    }, getDataDir());

    return NextResponse.json({ asset: created.asset, url: `/api/assets/${created.asset.id}` }, { status: created.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Icon generation failed.';
    return NextResponse.json({
      error: message.includes('ENOENT') ? 'codex-imagegen or ImageMagick is not installed or is not on PATH.' : message,
    }, { status: 500 });
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
