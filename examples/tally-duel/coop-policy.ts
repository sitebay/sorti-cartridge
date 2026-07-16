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
  RoomOpDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";
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
  };
}

function duelState(snapshot: DuelSnapshot): GameState | null {
  const state = snapshot?.state;
  return state && typeof state === "object" && Array.isArray(state.players) ? state : null;
}
