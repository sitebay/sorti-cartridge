/**
 * Tally Duel reducer — THE one mutation path (PANEL-AUTHORING.md §9).
 *
 * Pure function: never mutates the input state, never touches the clock or
 * entropy, throws on illegal actions (the MCP layer converts throws into
 * `isError` tool results). Replaying the action log through `reduce` from
 * `createRun(...)` reproduces the final state exactly — the replay test
 * in tests/reducer.test.ts enforces this.
 */

import { cloneState, type Action, type EngineEvent, type GameState } from "./state.ts";

export interface ReduceResult {
  state: GameState;
  events: EngineEvent[];
}

const BOOST_DELTA = 3;

export function reduce(state: GameState, action: Action): ReduceResult {
  if (state.screen_kind === "game_over") {
    throw new Error(`run ${state.runId} is over; start a new run`);
  }
  switch (action.kind) {
    case "tap":
      return score(state, action.playerId, 1, false);
    case "boost":
      return score(state, action.playerId, BOOST_DELTA, true);
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Convenience for client-side prediction bundles (same name STS2 exports). */
export function reduceOne(state: GameState, action: Action): ReduceResult {
  return reduce(state, action);
}

function score(state: GameState, playerId: string, delta: number, isBoost: boolean): ReduceResult {
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index < 0) throw new Error(`unknown player: ${playerId}`);
  if (isBoost && state.players[index]!.boostsLeft <= 0) {
    throw new Error(`player ${playerId} has no boosts left`);
  }

  const next = cloneState(state);
  const player = next.players[index]!;
  const events: EngineEvent[] = [];

  if (isBoost) {
    player.boostsLeft -= 1;
    events.push({ kind: "boost_spent", playerId, boostsLeft: player.boostsLeft });
  }
  player.score += delta;
  next.turnCount += 1;
  events.push({ kind: "score_changed", playerId, delta, score: player.score });

  if (player.score >= next.targetScore) {
    next.screen_kind = "game_over";
    next.winnerId = playerId;
    events.push({ kind: "game_over", winnerId: playerId });
  }

  return { state: next, events };
}

/** Legal-action derivation stays with the domain (see RoomSnapshot.legalActions). */
export function legalActions(state: GameState, playerId?: string): Action[] {
  if (state.screen_kind === "game_over") return [];
  const seats = playerId
    ? state.players.filter((player) => player.id === playerId)
    : state.players;
  const actions: Action[] = [];
  for (const seat of seats) {
    actions.push({ kind: "tap", playerId: seat.id });
    if (seat.boostsLeft > 0) actions.push({ kind: "boost", playerId: seat.id });
  }
  return actions;
}
