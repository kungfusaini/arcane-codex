import { NextRequest, NextResponse } from 'next/server';
import { RevisionConflictError, type PageMoveInput } from '@/lib/data/types';
import { applyPageMoves } from '@/lib/data/storage';
import { rejectPublishedMutation } from '@/lib/surface';

type ReorderPayload = {
  moves: PageMoveInput[];
};

export async function POST(request: NextRequest) {
  const blocked = rejectPublishedMutation('Reordering pages');
  if (blocked) return blocked;
  const payload = (await request.json().catch(() => ({}))) as ReorderPayload;
  const moves = Array.isArray(payload?.moves) ? payload.moves : [];

  if (!moves.length) {
    return NextResponse.json({ error: 'No moves provided' }, { status: 400 });
  }

  try {
    const normalized = moves.map((move) => {
      if (!move || typeof move.id !== 'string' || move.id.length === 0) {
        throw new Error('Each move requires an id');
      }
      if (!Object.hasOwn(move, 'revision') || typeof move.revision !== 'number' || !Number.isFinite(move.revision)) {
        throw new Error('Each move requires a revision number');
      }
      if (!Number.isFinite(move.sortKey)) {
        throw new Error('Each move requires a valid sortKey');
      }
      if (!(move.parentId === null || typeof move.parentId === 'string')) {
        throw new Error('Each move requires parentId');
      }

      return {
        id: move.id,
        parentId: move.parentId,
        sortKey: move.sortKey,
        revision: move.revision,
      } satisfies PageMoveInput;
    });

    const pages = applyPageMoves(normalized);
    return NextResponse.json({ pages });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
