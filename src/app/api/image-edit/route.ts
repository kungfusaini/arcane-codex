import { NextResponse } from 'next/server';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
export const runtime = 'nodejs';
export const maxDuration = 600;

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  return match ? { mime: match[1], data: Buffer.from(match[2], 'base64') } : null;
}

export async function POST(request: Request) {
  let temp = '';
  try {
    const body = await request.json() as { image?: string; prompt?: string };
    const prompt = body.prompt?.trim();
    if (!prompt) return NextResponse.json({ error: 'Describe the change first.' }, { status: 400 });
    if (prompt.length > 500) return NextResponse.json({ error: 'Keep the edit prompt under 500 characters.' }, { status: 400 });

    let source = body.image?.startsWith('data:') ? parseDataUrl(body.image) : null;
    if (!source && body.image?.startsWith('http')) {
      const remote = await fetch(body.image);
      if (remote.ok) {
        const mime = remote.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        source = { mime, data: Buffer.from(await remote.arrayBuffer()) };
      }
    }
    if (!source || !['image/png', 'image/jpeg', 'image/webp'].includes(source.mime)) {
      return NextResponse.json({ error: 'Choose a supported PNG, JPEG, or WebP image before editing.' }, { status: 400 });
    }
    const extension = source.mime === 'image/jpeg' ? 'jpg' : source.mime.split('/')[1];
    temp = await mkdtemp(join(tmpdir(), 'codex-image-edit-'));
    const inputPath = join(temp, `source.${extension}`);
    const outputPath = join(temp, 'edited.png');
    await writeFile(inputPath, source.data);

    const guardedPrompt = `Edit only this requested detail: ${prompt}. Preserve the exact subject identity, composition, camera angle, crop, framing, background, lighting, colors, texture, and every other image detail. Do not add or remove anything else. Make no changes beyond the requested edit.`;
    await execFileAsync('codex-imagegen', ['edit', '--prompt', guardedPrompt, '--image', inputPath, '--out', outputPath, '--force'], {
      timeout: 10 * 60 * 1000,
      env: { ...process.env, CODEX_IMAGEGEN_CODEX_VERSION: process.env.CODEX_IMAGEGEN_CODEX_VERSION || '0.200.0' },
    });
    const output = await readFile(outputPath);
    return NextResponse.json({ image: `data:image/png;base64,${output.toString('base64')}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codex Imagegen failed.';
    return NextResponse.json({ error: message.includes('ENOENT') ? 'codex-imagegen is not installed or is not on PATH.' : message }, { status: 500 });
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
