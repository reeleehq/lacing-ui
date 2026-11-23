// Undo for annotation edits: every delete and bulk edit here can be taken back in one step, so it
// acts at once and offers Undo (undo-toast) instead of asking first; a confirm is only for what one
// Undo cannot take back. undo-toast's `advise` decides which (the fleet's rule: a bulk action
// confirms with the count unless one Undo takes all of it back in place).
//
// The inverse of a delete is re-creating the same records (same ids), of an edit is writing the
// fields back as they were. When acture's undo transactions land (i2mint/acture#86) these pairs
// move into the command layer unchanged.

import type { Annotation } from '@/domain/envelope';
import { annotationsProvider } from '@/store/factories';
import { useUiStore } from '@/stores/ui';
import { type ActionContext, type PresetName, advise, offerUndo } from 'undo-toast';

export interface UndoableSpec<T> {
  /** What advise is told. */
  context: PresetName | ActionContext;
  extra?: ActionContext;
  /** Do it; what it returns is handed to `undo` (false: nothing done). */
  run: () => Promise<T | false>;
  /** Take back exactly what `run` did. */
  undo: (done: T) => Promise<unknown>;
  message: (done: T) => string;
  /** Asked only when advise says confirm (one Undo cannot take it back). */
  confirm?: (label: string) => Promise<boolean>;
}

const nativeConfirm = async (label: string) => window.confirm(`${label}?`);

/** Run an edit the safe way: confirm first or act and offer Undo, never both. Whether it ran. */
export async function undoable<T>({
  context,
  extra,
  run,
  undo,
  message,
  confirm = nativeConfirm,
}: UndoableSpec<T>): Promise<boolean> {
  const advice = advise(context, extra);
  if (advice.surface === 'confirm' && !(await confirm(advice.confirmLabel ?? 'Continue')))
    return false;
  const done = await run();
  useUiStore.getState().bumpData();
  if (done === false) return false;
  if (advice.surface === 'toast') {
    offerUndo({
      message: message(done),
      advice,
      undo: async () => {
        try {
          await undo(done);
          return true;
        } catch {
          return false; // shown as a failed undo, with Try again
        } finally {
          useUiStore.getState().bumpData();
        }
      },
    });
  }
  return true;
}

/** Re-create deleted annotations exactly (same ids, same fields). */
export async function recreate(records: readonly Annotation[]): Promise<void> {
  for (const r of records) await annotationsProvider.create(r);
}

/** Write fields back as they were, per annotation. */
export async function restoreFields(
  before: readonly { id: string; patch: Partial<Annotation> }[],
): Promise<void> {
  for (const { id, patch } of before) await annotationsProvider.update(id, patch);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
