/**
 * Tally Duel reducer — THE one mutation path (PANEL-AUTHORING.md §9).
 *
 * Pure function: never mutates the input state, never touches the clock or
 * entropy, throws on illegal actions (the MCP layer converts throws into
 * `isError` tool results). Replaying the action log through `reduce` from
 * `createRun(...)` reproduces the final state exactly — the replay test
 * in tests/reducer.test.ts enforces this.
 */

import {
  cloneState,
  DEFAULT_BOOSTS,
  type Action,
  type EngineEvent,
  type GameState,
} from "./state.ts";

export interface ReduceResult {
  state: GameState;
  events: EngineEvent[];
}

const BOOST_DELTA = 3;
/** A recharge trades exactly this much score for exactly one boost. */
const RECHARGE_COST = 2;
const RECHARGE_BOOSTS = 1;

export function reduce(state: GameState, action: Action): ReduceResult {
  if (state.screen_kind === "game_over") {
    throw new Error(`run ${state.runId} is over; start a new run`);
  }
  switch (action.kind) {
    case "tap":
      return score(state, action.playerId, 1, false);
    case "boost":
      return score(state, action.playerId, BOOST_DELTA, true);
    case "recharge":
      return recharge(state, action.playerId);
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

/**
 * Recharge — spend exactly `RECHARGE_COST` score to restore exactly one boost.
 *
 * Only legal while the seat can afford it AND is actually below the initial
 * allowance (`DEFAULT_BOOSTS`): a recharge tops a seat back up, it never mints
 * more boosts than a fresh run hands out. Scoring down can never win a run, so
 * this path never sets a winner — it only ever moves score and boosts on the
 * acting seat, plus the one turnCount tick every accepted action owes.
 */
function recharge(state: GameState, playerId: string): ReduceResult {
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index < 0) throw new Error(`unknown player: ${playerId}`);
  const seat = state.players[index]!;
  if (seat.score < RECHARGE_COST) {
    throw new Error(`player ${playerId} needs ${RECHARGE_COST} score to recharge`);
  }
  if (seat.boostsLeft >= DEFAULT_BOOSTS) {
    throw new Error(`player ${playerId} already has a full boost allowance`);
  }

  const next = cloneState(state);
  const player = next.players[index]!;
  player.score -= RECHARGE_COST;
  player.boostsLeft += RECHARGE_BOOSTS;
  next.turnCount += 1;

  return {
    state: next,
    events: [
      { kind: "score_changed", playerId, delta: -RECHARGE_COST, score: player.score },
      { kind: "boost_recharged", playerId, score: player.score, boostsLeft: player.boostsLeft },
    ],
  };
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
    // THE recharge rule lives here and nowhere else: panels ask, they don't restate.
    if (seat.score >= RECHARGE_COST && seat.boostsLeft < DEFAULT_BOOSTS) {
      actions.push({ kind: "recharge", playerId: seat.id });
    }
  }
  return actions;
}
