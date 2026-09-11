/**
 * Duel agent-seat policy — the smallest real implementation of the coop
 * decision seam (`Policy` from the contract): "should I act on this
 * snapshot, and what one op should I take?"
 *
 * Deterministic on purpose: a stochastic seat cannot be bisected. If you
 * want an LLM-driven seat, use `deps.askLlm` inside `decide` and keep this
 * heuristic as the fallback (the driver must still work when askLlm is
 * absent).
 */

import type {
  CoopPolicyDeps,
  Policy,
  PolicyAttention,
  RoomOpDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";
import { DUEL_PANEL_RESOURCE_URI } from "./panel/server.ts";
import type { Action, GameState } from "./state.ts";

type DuelSnapshot = RoomSnapshot<GameState | null>;

export function duelPolicy(_deps: CoopPolicyDeps = {}): Policy<unknown, unknown> {
  return {
    shouldAct(snapshot, seatId) {
      const state = duelState(snapshot as DuelSnapshot);
      if (!state || state.screen_kind === "game_over") return false;
      return state.players.some((player) => player.id === seatId);
    },
    decide(snapshot, seatId) {
      const state = duelState(snapshot as DuelSnapshot);
      if (!state || state.screen_kind === "game_over") return null;
      const seat = state.players.find((player) => player.id === seatId);
      if (!seat) return null;
      const bestOpponent = Math.max(
        0,
        ...state.players.filter((player) => player.id !== seatId).map((player) => player.score),
      );
      // Heuristic: spend a boost when behind (or it would win); otherwise tap.
      const boostWins = seat.score + 3 >= state.targetScore;
      const useBoost = seat.boostsLeft > 0 && (boostWins || seat.score < bestOpponent);
      const action: Action = useBoost
        ? { kind: "boost", playerId: seatId }
        : { kind: "tap", playerId: seatId };
      const draft: RoomOpDraft = {
        kind: action.kind,
        payload: action,
        label: useBoost ? "Boost +3" : "Tap +1",
        reason: useBoost
          ? boostWins
            ? "boost reaches the target"
            : "behind — spend a boost"
          : "steady taps",
        tier: "act",
        decidedBy: "heuristic",
      };
      return draft;
    },

    /**
     * Where this seat is looking, for the ephemeral halo lane (lifted from
     * sts2-engine 4c985b0f).
     *
     * ⛔ WHAT THIS BUYS OVER A `before:` SIGNAL. A signal in `decide` is a tool
     * call — worth spending on a play worth NARRATING, far too heavy for a
     * glance. This lane shows the ring for EVERY act, with no round trip,
     * because the driver publishes it on the unreliable ephemeral lane beside
     * the op it just decided.
     *
     * BOTH FIELDS ARE THIS APP'S VOCABULARY. `entityId` is a seat id the duel
     * itself resolves; `surfaceId` is the panel that seat is drawn on. A
     * driver that guessed either would be inventing ids on the app's behalf —
     * which is exactly why the contract made this a hook and not an inference.
     *
     * Pure and synchronous: no await, no mutation, null when there is nothing
     * to point at.
     */
    attention(draft, _snapshot, seatId): PolicyAttention | null {
      if (draft.kind !== "tap" && draft.kind !== "boost") return null;
      const payload = (draft.payload ?? {}) as { playerId?: unknown };
      const target = typeof payload.playerId === "string" ? payload.playerId : seatId;
      if (!target) return null;
      // A duel scores on its OWN seat, so the halo lands on the scoring plate.
      return { surfaceId: DUEL_PANEL_RESOURCE_URI, anchor: { type: "entityId", entityId: target } };
    },
  };
}

function duelState(snapshot: DuelSnapshot): GameState | null {
  const state = snapshot?.state;
  return state && typeof state === "object" && Array.isArray(state.players) ? state : null;
}
