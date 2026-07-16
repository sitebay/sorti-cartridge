/**
 * Board agent-seat policy — the coop decision seam for the spatial example.
 * The demo: two seats moving notes on the same board. This deterministic
 * "tidy bot" snaps off-grid notes to a 20px grid, one note per tick, so a
 * driver loop is observable and bisectable. Swap the heuristic for
 * `deps.askLlm` when you want a smarter seat (keep a deterministic
 * fallback — the policy must work when askLlm is absent).
 */

import type {
  CoopPolicyDeps,
  Policy,
  RoomOpDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";
import type { BoardAction, BoardState, Note } from "./state.ts";

const GRID = 20;

type BoardSnapshot = RoomSnapshot<BoardState | null>;

export function boardTidyPolicy(_deps: CoopPolicyDeps = {}): Policy<unknown, unknown> {
  return {
    shouldAct(snapshot) {
      return firstOffGridNote(boardState(snapshot as BoardSnapshot)) !== null;
    },
    decide(snapshot) {
      const note = firstOffGridNote(boardState(snapshot as BoardSnapshot));
      if (!note) return null;
      const action: BoardAction = {
        kind: "move_note",
        noteId: note.id,
        x: snap(note.x),
        y: snap(note.y),
      };
      const draft: RoomOpDraft = {
        kind: action.kind,
        payload: action,
        label: `Tidy ${note.id}`,
        reason: `snap ${note.id} to the ${GRID}px grid`,
        tier: "act",
        decidedBy: "heuristic",
      };
      return draft;
    },
  };
}

function boardState(snapshot: BoardSnapshot): BoardState | null {
  const state = snapshot?.state;
  return state && typeof state === "object" && Array.isArray(state.notes) ? state : null;
}

function firstOffGridNote(state: BoardState | null): Note | null {
  if (!state) return null;
  return state.notes.find((note) => note.x % GRID !== 0 || note.y % GRID !== 0) ?? null;
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}
