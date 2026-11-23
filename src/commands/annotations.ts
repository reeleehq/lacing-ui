// Commands for annotation CRUD + AI-assist actions.
//
// Every mutation goes through the active DataProvider; the result drives the
// list refresh. A delete acts at once and offers one Undo that re-creates the
// annotation exactly (src/lib/undo.ts), so it needs no confirmation.

import type { Annotation } from '@/domain/envelope';
import { annotationSchema } from '@/domain/envelope';
import { deleteAnnotations } from '@/lib/undo';
import { annotationsProvider } from '@/store/factories';
import { defineCommand } from 'command-wrapex';
import { z } from 'zod';

/** Delete one annotation with one Undo that re-creates it exactly. */
export async function deleteWithUndo(
  id: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const record = await annotationsProvider.getOne(id);
  return deleteAnnotations([record], () => message);
}

export const createAnnotationCmd = defineCommand({
  id: 'lacing.annotations.create',
  label: 'Create annotation',
  category: 'Annotations',
  description: 'Create a new annotation in the active project.',
  schema: annotationSchema.partial({ id: true }),
  execute: async (params) => {
    // The Zod input type allows defaulted fields to be omitted; the provider
    // type expects the post-default shape. Cast at the boundary.
    const created = await annotationsProvider.create(params as Partial<Annotation>);
    return { success: true, message: `Created ${created.id}`, data: created };
  },
});

export const updateAnnotationCmd = defineCommand({
  id: 'lacing.annotations.update',
  label: 'Update annotation',
  category: 'Annotations',
  description: "Patch an annotation's body, tier, or confidence.",
  schema: z.object({
    id: z.guid(),
    patch: annotationSchema.partial().omit({ id: true }),
  }),
  when: 'selection.kind === "annotation"',
  execute: async ({ id, patch }) => {
    const updated = await annotationsProvider.update(id, patch as Partial<Annotation>);
    return { success: true, message: `Updated ${id}`, data: updated };
  },
});

export const deleteAnnotationCmd = defineCommand({
  id: 'lacing.annotations.delete',
  label: 'Delete annotation',
  category: 'Annotations',
  description: 'Remove an annotation by id.',
  schema: z.object({ id: z.guid() }),
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    const out = await deleteWithUndo(id, 'Annotation deleted');
    return { success: out.ok, message: out.ok ? `Deleted ${id}` : out.error };
  },
});

export const acceptAiSuggestionCmd = defineCommand({
  id: 'lacing.annotations.acceptAi',
  label: 'Accept AI suggestion',
  category: 'AI',
  description: 'Promote an AI-suggested annotation to confidence 1.0.',
  schema: z.object({ id: z.guid() }),
  keybinding: { key: 'A', meta: true, shift: true },
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    const updated = await annotationsProvider.update(id, { confidence: 1 });
    return { success: true, data: updated };
  },
});

export const rejectAiSuggestionCmd = defineCommand({
  id: 'lacing.annotations.rejectAi',
  label: 'Reject AI suggestion',
  category: 'AI',
  description: 'Delete an AI-suggested annotation.',
  schema: z.object({ id: z.guid() }),
  keybinding: { key: 'X', meta: true, shift: true },
  when: 'selection.kind === "annotation"',
  execute: async ({ id }) => {
    const out = await deleteWithUndo(id, 'AI suggestion rejected');
    return { success: out.ok, message: out.error };
  },
});

export const listAnnotationsCmd = defineCommand({
  id: 'lacing.annotations.list',
  label: 'List annotations',
  category: 'Annotations',
  description: 'Reload annotations from the active backend.',
  execute: async () => {
    const result = await annotationsProvider.getList({});
    return { success: true, data: result };
  },
});

export const annotationCommands = [
  createAnnotationCmd,
  updateAnnotationCmd,
  deleteAnnotationCmd,
  acceptAiSuggestionCmd,
  rejectAiSuggestionCmd,
  listAnnotationsCmd,
];
