// uiStore — ephemeral UI state (selection, the multi-selection, palette open, last list size).
// Domain mutations go through the command registry → DataProvider; this store
// only holds throwaway state the UI reads directly.

import { create } from 'zustand';

export type Selection =
  | { kind: 'none' }
  | { kind: 'annotation'; id: string }
  | { kind: 'tier'; name: string };

interface UiState {
  /** The one annotation or tier in focus (the Inspector's subject). */
  selection: Selection;
  /** The annotations a selection action applies to (Cmd/Ctrl-click toggles, Shift-click picks a range). */
  picked: string[];
  /** The last annotation toggled: a Shift-click picks from here. */
  anchor: string | null;
  /** Bumped after a mutation outside App's own handlers, so the lists are read again. */
  dataVersion: number;
  /** Toggle one annotation in the multi-selection, or (`range`) add every one from the anchor to it in `order`. */
  pick: (id: string, range?: { order: readonly string[] }) => void;
  setPicked: (ids: readonly string[]) => void;
  clearPicked: () => void;
  bumpData: () => void;
  paletteOpen: boolean;
  lastListSize: number;
  setSelection: (s: Selection) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setLastListSize: (n: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selection: { kind: 'none' },
  picked: [],
  anchor: null,
  dataVersion: 0,
  pick: (id, range) =>
    set((s) => {
      const order = range?.order ?? [];
      const a = s.anchor ? order.indexOf(s.anchor) : -1;
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        return { picked: [...new Set([...s.picked, ...span])], anchor: id };
      }
      return {
        picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : [...s.picked, id],
        anchor: id,
      };
    }),
  setPicked: (ids) => set({ picked: [...ids] }),
  clearPicked: () => set({ picked: [], anchor: null }),
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  paletteOpen: false,
  lastListSize: 0,
  setSelection: (selection) => set({ selection }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setLastListSize: (n) => set({ lastListSize: n }),
}));
