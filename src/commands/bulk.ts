// Selection actions: commands whose input is the multi-selection (uiStore.picked). Each is one
// step and one Undo for the whole selection (src/lib/undo.ts), and none needs a confirm, because
// each can be taken back exactly: deleted annotations are re-created with the same ids, and moved
// or nudged ones get their old tier or interval back.
//
// Shaped as the fleet's selection commands (i2mint/acture#86): the selection is the input, the
// undo policy is undo-toast's advice.

import type { Annotation } from '@/domain/envelope';
import { fromMicros, intervalToMicros } from '@/domain/time';
import { plural, recreate, restoreFields, undoable } from '@/lib/undo';
import { annotationsProvider } from '@/store/factories';
import { useUiStore } from '@/stores/ui';
import { defineCommand } from 'command-wrapex';
import { z } from 'zod';

/** The picked annotations as the server has them now (one that is gone is left out). */
async function pickedRecords(): Promise<Annotation[]> {
  const ids = useUiStore.getState().picked;
  const out: Annotation[] = [];
  for (const id of ids) {
    try {
      out.push(await annotationsProvider.getOne(id));
    } catch {
      // deleted meanwhile: nothing to act on
    }
  }
  return out;
}

const nothingPicked = { success: false, message: 'Nothing selected.' } as const;

export const deletePickedCmd = defineCommand({
  id: 'lacing.selection.delete',
  label: 'Delete selected annotations',
  category: 'Selection',
  description:
    'Delete every selected annotation (lift: other annotations do not move). One Undo brings them all back.',
  when: 'picked.length > 0',
  execute: async () => {
    const records = await pickedRecords();
    if (!records.length) return nothingPicked;
    const ok = await undoable({
      context: records.length === 1 ? 'remove-item' : 'bulk-delete',
      extra: { count: records.length, reversal: 'compensating' },
      run: async () => {
        const done: Annotation[] = [];
        for (const r of records) {
          await annotationsProvider.delete(r.id);
          done.push(r);
        }
        useUiStore.getState().clearPicked();
        return done;
      },
      undo: (done) => recreate(done),
      message: (done) => `${plural(done.length, 'annotation', 'annotations')} deleted`,
    });
    return { success: ok };
  },
});

export const movePickedToTierCmd = defineCommand({
  id: 'lacing.selection.moveToTier',
  label: 'Move selected annotations to a tier',
  category: 'Selection',
  schema: z.object({ tier: z.string().min(1) }),
  when: 'picked.length > 0',
  execute: async ({ tier }) => {
    const records = (await pickedRecords()).filter((r) => r.tier !== tier);
    if (!records.length)
      return { success: false, message: `All selected annotations are already on ${tier}.` };
    const ok = await undoable({
      context: { reversal: 'compensating', cost: 'low' },
      extra: { count: records.length },
      run: async () => {
        for (const r of records) await annotationsProvider.update(r.id, { tier });
        return records.map((r) => ({ id: r.id, patch: { tier: r.tier } }));
      },
      undo: (before) => restoreFields(before),
      message: (before) => `${plural(before.length, 'annotation', 'annotations')} moved to ${tier}`,
    });
    return { success: ok };
  },
});

export const nudgePickedCmd = defineCommand({
  id: 'lacing.selection.nudge',
  label: 'Nudge selected annotations',
  category: 'Selection',
  description:
    'Shift every selected annotation earlier or later by the same amount (milliseconds; never before 0).',
  schema: z.object({ ms: z.number().int() }),
  when: 'picked.length > 0',
  execute: async ({ ms }) => {
    const timed = (await pickedRecords()).flatMap((r) => (r.reference.interval ? [{ r, i: r.reference.interval }] : []));
    if (!timed.length) return nothingPicked;
    const records = timed.map((t) => t.r);
    // The whole selection moves together: an earlier nudge stops where the earliest one reaches 0.
    const starts = timed.map((t) => intervalToMicros(t.i).start);
    const delta = Math.max(ms * 1000, -Math.min(...starts));
    if (delta === 0) return { success: false, message: 'Already at the start.' };
    const ok = await undoable({
      context: { reversal: 'compensating', cost: 'low' },
      extra: { count: records.length },
      run: async () => {
        for (const { r, i } of timed) {
          const { start, end } = intervalToMicros(i);
          const rate = i.start.r;
          await annotationsProvider.update(r.id, {
            reference: {
              ...r.reference,
              interval: {
                start: fromMicros(start + delta, rate),
                end: fromMicros(end + delta, rate),
              },
            },
          });
        }
        return records.map((r) => ({ id: r.id, patch: { reference: r.reference } }));
      },
      undo: (before) => restoreFields(before),
      message: (before) =>
        `${plural(before.length, 'annotation', 'annotations')} moved ${delta > 0 ? 'later' : 'earlier'} by ${Math.abs(delta) / 1000} ms`,
    });
    return { success: ok };
  },
});

export const clearPickedCmd = defineCommand({
  id: 'lacing.selection.clearPicked',
  label: 'Clear the multi-selection',
  category: 'Selection',
  when: 'picked.length > 0',
  execute: async () => {
    useUiStore.getState().clearPicked();
    return { success: true };
  },
});

export const bulkCommands = [deletePickedCmd, movePickedToTierCmd, nudgePickedCmd, clearPickedCmd];
