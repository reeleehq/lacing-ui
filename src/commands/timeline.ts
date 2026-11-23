// NLE timeline edit commands: blade (split at playhead), lift (delete keep gap),
// ripple (delete and close gap on the same tier).
//
// These mutate annotations through the existing annotationsProvider. Lift and
// ripple offer one Undo (src/lib/undo.ts): the deleted annotation is re-created
// with its id, and a ripple's shifted siblings get their intervals back.

import type { Annotation } from '@/domain/envelope';
import { fromMicros, intervalToMicros } from '@/domain/time';
import { recreate, restoreFields, undoable } from '@/lib/undo';
import { annotationsProvider } from '@/store/factories';
import { useTransportStore } from '@/stores/transport';
import { useUiStore } from '@/stores/ui';
import { defineCommand } from 'command-wrapex';
import { z } from 'zod';
import { deleteWithUndo } from './annotations';
import { deletePicked } from './bulk';

// --- helpers --------------------------------------------------------------

async function loadAnnotation(id: string): Promise<Annotation> {
  return annotationsProvider.getOne(id);
}

function intervalAt(start: number, end: number, rate: number) {
  // Spans must be non-empty; bump end by one tick if the user hits exactly the
  // playhead (avoids a degenerate zero-length annotation).
  return {
    start: fromMicros(Math.max(0, start), rate),
    end: fromMicros(Math.max(start + 1, end), rate),
  };
}

function withInterval(ann: Annotation, start: number, end: number) {
  const interval = ann.reference.interval;
  if (!interval) throw new Error('annotation has no interval to edit');
  const rate = interval.start.r;
  return {
    ...ann.reference,
    interval: intervalAt(start, end, rate),
  };
}

// --- commands -------------------------------------------------------------

export const bladeCmd = defineCommand({
  id: 'lacing.timeline.blade',
  label: 'Blade at playhead',
  category: 'Timeline',
  description:
    'Split the selected annotation at the current playhead into two pieces. The right half is created as a new annotation that copies tier, body, and provenance.',
  schema: z.object({ id: z.guid() }),
  keybinding: { key: 'B' },
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    const ann = await loadAnnotation(id);
    const interval = ann.reference.interval;
    if (!interval) {
      return { success: false, message: 'annotation has no interval' };
    }
    const playhead = useTransportStore.getState().playhead;
    const { start, end } = intervalToMicros(interval);
    if (playhead <= start || playhead >= end) {
      return { success: false, message: 'playhead is outside the annotation' };
    }
    // Left: shrink to [start, playhead).
    const leftRef = withInterval(ann, start, playhead);
    await annotationsProvider.update(id, { reference: leftRef });
    // Right: new annotation [playhead, end).
    const rightRef = withInterval(ann, playhead, end);
    const right = {
      ...ann,
      id: crypto.randomUUID(),
      reference: rightRef,
    };
    const created = await annotationsProvider.create(right);
    return { success: true, message: `Split into ${id} + ${created.id}`, data: created };
  },
});

export const liftCmd = defineCommand({
  id: 'lacing.timeline.lift',
  label: 'Lift (delete, keep gap)',
  category: 'Timeline',
  description: 'Delete the selected annotation. Other annotations on the same tier do not move.',
  schema: z.object({ id: z.guid() }),
  keybinding: { key: 'Delete' },
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    // With several annotations picked, Delete acts on the picked ones (what the user sees selected).
    if (useUiStore.getState().picked.length > 0) return deletePicked();
    const out = await deleteWithUndo(id, 'Annotation lifted');
    return { success: out.ok, message: out.ok ? `Lifted ${id}` : out.error };
  },
});

export const rippleCmd = defineCommand({
  id: 'lacing.timeline.ripple',
  label: 'Ripple delete (close gap)',
  category: 'Timeline',
  description:
    'Delete the selected annotation and shift every later annotation on the same tier earlier by the deleted duration.',
  schema: z.object({ id: z.guid() }),
  keybinding: { key: 'Backspace', shift: true },
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    const ann = await loadAnnotation(id);
    const interval = ann.reference.interval;
    if (!interval) {
      return { success: false, message: 'annotation has no interval' };
    }
    const { start, end } = intervalToMicros(interval);
    const duration = end - start;

    // Delete first, then shift later siblings on the same tier. One Undo re-creates the
    // annotation and puts every shifted sibling back; if a shift fails part-way, what was
    // done is still offered for Undo.
    const out = await undoable<{
      deleted: Annotation[];
      before: { id: string; patch: Partial<Annotation> }[];
    }>({
      context: 'remove-item',
      start: () => ({ deleted: [], before: [] }),
      run: async (done) => {
        await annotationsProvider.delete(id);
        done.deleted.push(ann);
        const all = await annotationsProvider.getList({});
        const toShift = all.data.filter((a) => {
          if (a.id === id) return false;
          if (a.tier !== ann.tier) return false;
          const ai = a.reference.interval;
          if (!ai) return false;
          return intervalToMicros(ai).start >= end;
        });
        for (const a of toShift) {
          const ai = a.reference.interval;
          if (!ai) continue;
          const { start: s, end: e } = intervalToMicros(ai);
          const newRef = withInterval(a, s - duration, e - duration);
          await annotationsProvider.update(a.id, { reference: newRef });
          done.before.push({ id: a.id, patch: { reference: a.reference } });
        }
      },
      isEmpty: (done) => done.deleted.length === 0,
      undo: async ({ deleted, before }) => {
        await restoreFields(before);
        await recreate(deleted);
      },
      message: ({ before }) =>
        `Ripple delete: ${before.length} later annotation${before.length === 1 ? '' : 's'} moved up`,
    });
    return {
      success: out.ok,
      message: out.ok ? `Rippled ${id} (-${duration}μs)` : out.error,
    };
  },
});

export const timelineCommands = [bladeCmd, liftCmd, rippleCmd];
