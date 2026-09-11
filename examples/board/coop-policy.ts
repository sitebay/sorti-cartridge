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
  PolicyAttention,
  RoomOpDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";
import { BOARD_PANEL_RESOURCE_URI } from "./panel/server.ts";
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

    /**
     * Where this seat is looking, for the ephemeral halo lane (lifted from
     * sts2-engine 4c985b0f). The partner sees the ring settle on the note a
     * beat before it moves — without a tool call, because a glance is not
     * worth a round trip through the reliable lane.
     *
     * Only the ops with a VISIBLE target answer. A domain that cannot name a
     * surface names none and the frame lands unscoped rather than wrongly
     * scoped; a domain with nothing to point at returns null and emits
     * nothing, which is what every domain did before the hook existed.
     *
     * Pure and synchronous: no await, no mutation.
     */
    attention(draft): PolicyAttention | null {
      if (draft.kind !== "move_note") return null;
      const payload = (draft.payload ?? {}) as { noteId?: unknown };
      const noteId = typeof payload.noteId === "string" ? payload.noteId : "";
      if (!noteId) return null;
      return { surfaceId: BOARD_PANEL_RESOURCE_URI, anchor: { type: "entityId", entityId: noteId } };
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
