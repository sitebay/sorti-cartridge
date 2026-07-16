/**
 * Sticky Board — the productivity/spatial-flavor example app state.
 *
 * A board of sticky notes; one board ("document") per run. It looks
 * canvas-like, but it is NOT the host canvas: it's a guest panel that
 * happens to be a spatial surface — same reducer/panel physics as any
 * other app.
 *
 * THE STATE-OWNERSHIP RULE (PANEL-AUTHORING.md §3) applies unchanged:
 * everything here is authoritative and replayable. Determinism rules: no
 * `Date.now()`, no `Math.random()` (note ids and default placement derive
 * from counters + `seed`), no `Map`/`Set` in stored state.
 */

export type NoteColor = "yellow" | "pink" | "blue" | "green";

export const NOTE_COLORS: readonly NoteColor[] = ["yellow", "pink", "blue", "green"];

export interface Note {
  id: string;
  text: string;
  /** Logical surface coordinates (top-left of the note), clamped by the reducer. */
  x: number;
  y: number;
  color: NoteColor;
}

export interface BoardState {
  runId: string;
  seed: number;
  screen_kind: "board";
  /** Logical surface size the panel scales to. */
  width: number;
  height: number;
  notes: Note[];
  /** Deterministic id source: note ids are `n1`, `n2`, ... */
  nextNoteId: number;
  /** Count of accepted actions; doubles as a cheap op sequence. */
  opCount: number;
}

export type BoardAction =
  | { kind: "add_note"; text: string; x?: number; y?: number; color?: NoteColor }
  | { kind: "move_note"; noteId: string; x: number; y: number }
  | { kind: "edit_note"; noteId: string; text: string }
  | { kind: "remove_note"; noteId: string }
  | { kind: "set_color"; noteId: string; color: NoteColor };

export type BoardEvent =
  | { kind: "note_added"; noteId: string }
  | { kind: "note_moved"; noteId: string; x: number; y: number }
  | { kind: "note_edited"; noteId: string }
  | { kind: "note_removed"; noteId: string }
  | { kind: "note_recolored"; noteId: string; color: NoteColor };

export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 600;
export const NOTE_TEXT_MAX = 280;

export interface NewBoardArgs {
  runId: string;
  seed?: number;
}

/** Deterministic board mint. The caller supplies `runId` (identity is the host's). */
export function createBoard(args: NewBoardArgs): BoardState {
  const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed as number) : 1;
  return {
    runId: args.runId,
    seed,
    screen_kind: "board",
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    notes: [],
    nextNoteId: 1,
    opCount: 0,
  };
}

/** JSON-safe clone (mirrors the run store's storage round-trip). */
export function cloneBoard(state: BoardState): BoardState {
  return structuredClone(state);
}
