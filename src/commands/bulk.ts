// Selection actions: commands whose input is the multi-selection (uiStore.picked). Each is one
// step and one Undo for the whole selection (src/lib/undo.ts), and none needs a confirm, because
// each can be taken back exactly: deleted annotations are re-created with the same ids, and moved
// ones get their old tier back. (Nudging a selection in time waits for the server to accept
// `reference` in an annotation patch: reeleehq/lacing issue on AnnotationPatch.)
//
// Shaped as the fleet's selection commands (i2mint/acture#86): the selection is the input, the
// undo policy is undo-toast's advice.

import type { Annotation } from '@/domain/envelope';
import { deleteAnnotations, plural, restoreFields, undoLast, undoable } from '@/lib/undo';
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

/** Delete the picked annotations (lift: the others do not move), with one Undo. */
export async function deletePicked(): Promise<{ success: boolean; message?: string }> {
  const records = await pickedRecords();
  if (!records.length) return nothingPicked;
  useUiStore.getState().clearPicked();
  const out = await deleteAnnotations(
    records,
    (n) => `${plural(n, 'annotation', 'annotations')} deleted`,
    records.length === 1 ? 'remove-item' : 'bulk-delete',
  );
  return { success: out.ok, message: out.error };
}

export const deletePickedCmd = defineCommand({
  id: 'lacing.selection.delete',
  label: 'Delete selected annotations',
  category: 'Selection',
  description:
    'Delete every selected annotation (lift: other annotations do not move). One Undo brings them all back.',
  when: 'picked.length > 0',
  execute: () => deletePicked(),
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
    const out = await undoable<{ id: string; patch: Partial<Annotation> }[]>({
      context: { reversal: 'compensating', cost: 'low' },
      extra: { count: records.length },
      start: () => [],
      run: async (before) => {
        for (const r of records) {
          await annotationsProvider.update(r.id, { tier });
          before.push({ id: r.id, patch: { tier: r.tier } });
        }
      },
      isEmpty: (before) => before.length === 0,
      undo: (before) => restoreFields(before),
      message: (before) => `${plural(before.length, 'annotation', 'annotations')} moved to ${tier}`,
    });
    return { success: out.ok, message: out.error };
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

export const undoLastCmd = defineCommand({
  id: 'lacing.history.undo',
  label: 'Undo last edit',
  category: 'History',
  description:
    'Take back the latest delete or bulk edit still open, even after its Undo toast has gone.',
  execute: async () => {
    const what = await undoLast();
    return what
      ? { success: true, message: `Undone: ${what}` }
      : { success: false, message: 'Nothing to undo.' };
  },
});

export const bulkCommands = [deletePickedCmd, movePickedToTierCmd, clearPickedCmd, undoLastCmd];
