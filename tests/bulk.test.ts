// Multi-selection and selection actions: one step and one Undo for the whole selection, and
// the single deletes (lift, ripple, tier) taken back exactly.

import { registerAllCommands, registry } from '@/commands';
import type { Tier } from '@/domain/collections';
import type { Annotation } from '@/domain/envelope';
import { makeHandlers } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { useUiStore } from '@/stores/ui';
import { getUndoOffers } from 'undo-toast';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  registerAllCommands();
});

const tier = (name: string, parent: string | null = null): Tier => ({
  name,
  stereotype: parent ? 'TIME_SUBDIVISION' : 'NONE',
  parent: parent ?? undefined,
  metadata: {},
});

const ann = (
  id: string,
  tierName: string,
  startMicros: number,
  endMicros: number,
  text = 'x',
): Annotation => ({
  id,
  tier: tierName,
  reference: {
    kind: 'media',
    asset_id: 'sha256:test',
    interval: {
      start: { v: Math.round((startMicros / 1_000_000) * 24000), r: 24000 },
      end: { v: Math.round((endMicros / 1_000_000) * 24000), r: 24000 },
    },
  },
  body: { text },
  body_schema_uri: 'annot://schema/word/v1',
  provenance: {
    was_generated_by: 'user:test',
    was_attributed_to: 'test',
    was_derived_from: [],
    generated_at_time: { v: 0, r: 1 },
    activity: 'create',
  },
});

afterEach(() => {
  server.resetHandlers();
  getUndoOffers().close();
  useUiStore.getState().clearPicked();
  useUiStore.getState().setSelection({ kind: 'none' });
});

const list = async () => (await (await fetch('/api/annotations')).json()) as Annotation[];
const byId = async (id: string) => (await list()).find((x) => x.id === id);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const seed = () => ({
  annotations: [ann(A, 'words', 0, 500_000, 'a'), ann(B, 'words', 600_000, 1_000_000, 'b'), ann(C, 'phonemes', 700_000, 900_000, 'c')],
  tiers: [tier('words'), tier('phonemes')],
});

describe('picking', () => {
  it('toggles one, and shift picks the range from the anchor in the given order', () => {
    const { pick } = useUiStore.getState();
    pick(A);
    pick(C, { order: [A, B, C] });
    expect(useUiStore.getState().picked).toEqual([A, B, C]);
    pick(B);
    expect(useUiStore.getState().picked).toEqual([A, C]);
  });
});

describe('selection actions', () => {
  it('delete removes every picked annotation, and one Undo re-creates them with their ids', async () => {
    server.use(...makeHandlers(seed()));
    useUiStore.getState().setPicked([A, C]);
    expect((await registry.execute('lacing.selection.delete', undefined, { source: 'test' })).success).toBe(true);
    expect((await list()).map((x) => x.id)).toEqual([B]);
    expect(useUiStore.getState().picked).toEqual([]);
    expect(getUndoOffers().current()?.message).toBe('2 annotations deleted');
    expect(await getUndoOffers().undo()).toBe(true);
    expect((await list()).map((x) => x.id).sort()).toEqual([A, B, C].sort());
    expect((await byId(C))?.body.text).toBe('c');
  });

  it('move to tier, and Undo puts each back on its own tier', async () => {
    server.use(...makeHandlers(seed()));
    useUiStore.getState().setPicked([A, C]);
    await registry.execute('lacing.selection.moveToTier', { tier: 'words' }, { source: 'test' });
    expect((await byId(C))?.tier).toBe('words');
    expect(getUndoOffers().current()?.message).toBe('1 annotation moved to words'); // A was already there
    await getUndoOffers().undo();
    expect((await byId(C))?.tier).toBe('phonemes');
  });

  it('nudge moves the selection together, never before 0, and Undo restores the intervals', async () => {
    server.use(...makeHandlers(seed()));
    useUiStore.getState().setPicked([A, B]);
    await registry.execute('lacing.selection.nudge', { ms: 100 }, { source: 'test' });
    expect((await byId(B))?.reference.interval?.start.v).toBe((700_000 / 1_000_000) * 24000);
    await getUndoOffers().undo();
    expect((await byId(B))?.reference.interval?.start.v).toBe((600_000 / 1_000_000) * 24000);
    const earlier = await registry.execute('lacing.selection.nudge', { ms: -100 }, { source: 'test' });
    expect(earlier.success).toBe(false); // A starts at 0
  });
});

describe('single deletes are undoable', () => {
  it('ripple delete: Undo re-creates it and moves the later siblings back', async () => {
    server.use(...makeHandlers(seed()));
    useUiStore.getState().setSelection({ kind: 'annotation', id: A });
    expect((await registry.execute('lacing.timeline.ripple', { id: A }, { source: 'test' })).success).toBe(true);
    expect(await byId(A)).toBeUndefined();
    expect((await byId(B))?.reference.interval?.start.v).toBe((100_000 / 1_000_000) * 24000);
    expect(await getUndoOffers().undo()).toBe(true);
    expect((await byId(A))?.body.text).toBe('a');
    expect((await byId(B))?.reference.interval?.start.v).toBe((600_000 / 1_000_000) * 24000);
  });

  it('lift and tier delete offer Undo instead of deleting for good', async () => {
    server.use(...makeHandlers(seed()));
    useUiStore.getState().setSelection({ kind: 'annotation', id: B });
    expect((await registry.execute('lacing.timeline.lift', { id: B }, { source: 'test' })).success).toBe(true);
    expect(await byId(B)).toBeUndefined();
    await getUndoOffers().undo();
    expect(await byId(B)).toBeDefined();
    useUiStore.getState().setSelection({ kind: 'tier', name: 'phonemes' });
    expect((await registry.execute('lacing.tiers.delete', { name: 'phonemes' }, { source: 'test' })).success).toBe(true);
    expect(getUndoOffers().current()?.message).toBe('Tier phonemes deleted');
    await getUndoOffers().undo();
    const tiers = (await (await fetch('/api/tiers')).json()) as Tier[];
    expect(tiers.map((t) => t.name)).toContain('phonemes');
  });
});
