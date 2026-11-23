// The selection bar: shown when annotations are multi-selected (Cmd/Ctrl-click, Shift-click on the
// timeline or the list). Its buttons are the selection commands (src/commands/bulk.ts): each acts
// at once with one Undo for the whole selection.

import { registry } from '@/commands';
import type { Tier } from '@/domain/collections';
import { useUiStore } from '@/stores/ui';
import { useState } from 'react';
import { Button } from './button';

const NUDGE_MS = 100;

export function SelectionBar({ tiers }: { tiers: Tier[] }) {
  const picked = useUiStore((s) => s.picked);
  const [tier, setTier] = useState('');
  const [busy, setBusy] = useState(false);
  if (!picked.length) return null;
  const run = async (id: string, params?: unknown) => {
    setBusy(true);
    try {
      await registry.execute(id, params, { source: 'selection-bar' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Selected annotations"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm"
    >
      <span aria-live="polite" className="font-medium">
        {picked.length} selected
      </span>
      <select
        aria-label="Tier to move the selection to"
        value={tier}
        onChange={(e) => setTier(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        <option value="">Move to tier…</option>
        {tiers.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !tier}
        onClick={() => void run('lacing.selection.moveToTier', { tier })}
      >
        Move
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        aria-label={`Nudge ${NUDGE_MS} ms earlier`}
        onClick={() => void run('lacing.selection.nudge', { ms: -NUDGE_MS })}
      >
        −{NUDGE_MS} ms
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        aria-label={`Nudge ${NUDGE_MS} ms later`}
        onClick={() => void run('lacing.selection.nudge', { ms: NUDGE_MS })}
      >
        +{NUDGE_MS} ms
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => void run('lacing.selection.delete')}
      >
        Delete {picked.length}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => useUiStore.getState().clearPicked()}
      >
        Clear
      </Button>
    </section>
  );
}
