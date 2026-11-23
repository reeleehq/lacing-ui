// Undo for annotation edits: every delete and bulk edit here can be taken back in one step, so it
// acts at once and offers Undo (undo-toast) instead of asking first; a confirm is only for what one
// Undo cannot take back. undo-toast's `advise` decides which (the fleet's rule: a bulk action
// confirms with the count unless one Undo takes all of it back in place).
//
// Every action is also kept in a short undo history, so an Undo replaced by a newer toast is not
// lost: the palette's "Undo last edit" (lacing.history.undo) takes back the latest one still open.
//
// An action fills its `done` record as it goes, so when it fails half-way the part that was done
// can still be taken back. The inverses are idempotent (re-creating an annotation that exists is
// skipped), so Try again after a half-failed Undo finishes the job instead of failing on duplicates.
//
// When acture's undo transactions land (i2mint/acture#86) these pairs move into the command layer
// unchanged; a server soft delete replaces `recreate` in one place.

import type { Annotation } from '@/domain/envelope';
import { annotationsProvider } from '@/store/factories';
import { useUiStore } from '@/stores/ui';
import { type ActionContext, type PresetName, advise, offerUndo } from 'undo-toast';

export interface UndoableSpec<D> {
  /** What advise is told. */
  context: PresetName | ActionContext;
  extra?: ActionContext;
  /** An empty record of what was done; `run` fills it as it goes. */
  start: () => D;
  run: (done: D) => Promise<void>;
  /** Whether nothing was done (then no Undo is offered). */
  isEmpty: (done: D) => boolean;
  /** Take back exactly what was done (safe to repeat). */
  undo: (done: D) => Promise<void>;
  message: (done: D) => string;
  /** Asked only when advise says confirm (one Undo cannot take it back). */
  confirm?: (label: string) => Promise<boolean>;
}

export interface Outcome {
  ok: boolean;
  /** Why it stopped part-way or did nothing, in words. */
  error?: string;
}

interface HistoryEntry {
  message: string;
  undo: () => Promise<boolean>;
}

/** The latest actions still open to an Undo, newest last. */
const history: HistoryEntry[] = [];
const HISTORY_MAX = 20;

const nativeConfirm = async (label: string) => window.confirm(`${label}?`);

/** Run an edit the safe way: confirm first or act and offer Undo, never both. */
export async function undoable<D>({
  context,
  extra,
  start,
  run,
  isEmpty,
  undo,
  message,
  confirm = nativeConfirm,
}: UndoableSpec<D>): Promise<Outcome> {
  const advice = advise(context, { ...extra, hasUndoStack: true });
  if (advice.surface === 'confirm' && !(await confirm(advice.confirmLabel ?? 'Continue')))
    return { ok: false, error: 'Cancelled.' };
  const done = start();
  let error: string | undefined;
  try {
    await run(done);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    useUiStore.getState().bumpData();
  }
  if (isEmpty(done)) return { ok: false, error: error ?? 'Nothing to do.' };
  const entry: HistoryEntry = {
    message: `${message(done)}${error ? ` (stopped part-way: ${error})` : ''}`,
    undo: async () => {
      try {
        await undo(done);
        history.splice(history.indexOf(entry), 1);
        return true;
      } catch {
        return false; // shown as a failed undo, with Try again
      } finally {
        useUiStore.getState().bumpData();
      }
    },
  };
  history.push(entry);
  if (history.length > HISTORY_MAX) history.shift();
  if (advice.surface === 'toast') offerUndo({ message: entry.message, advice, undo: entry.undo });
  return { ok: !error, error };
}

/** Take back the latest action still open (the palette's "Undo last edit"). */
export async function undoLast(): Promise<string | null> {
  const entry = history.at(-1);
  if (!entry) return null;
  return (await entry.undo()) ? entry.message : null;
}

/** Re-create deleted annotations exactly (same ids, same fields); one that exists already is skipped. */
export async function recreate(records: readonly Annotation[]): Promise<void> {
  for (const r of records) {
    try {
      await annotationsProvider.getOne(r.id);
      continue; // back already (an earlier, half-finished Undo)
    } catch {
      // not there: re-create it
    }
    await annotationsProvider.create(r);
  }
}

/** Write fields back as they were, per annotation. */
export async function restoreFields(
  before: readonly { id: string; patch: Partial<Annotation> }[],
): Promise<void> {
  for (const { id, patch } of before) await annotationsProvider.update(id, patch);
}

/** Delete annotations with one Undo that re-creates them: the one delete-and-inverse pair (a soft delete replaces it here). */
export function deleteAnnotations(
  records: readonly Annotation[],
  message: (n: number) => string,
  context: PresetName = 'remove-item',
): Promise<Outcome> {
  return undoable<Annotation[]>({
    context,
    extra: { count: records.length, reversal: 'compensating' },
    start: () => [],
    run: async (done) => {
      for (const r of records) {
        await annotationsProvider.delete(r.id);
        done.push(r);
      }
    },
    isEmpty: (done) => done.length === 0,
    undo: (done) => recreate(done),
    message: (done) => message(done.length),
  });
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
