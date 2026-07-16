/**
 * Tally Duel — the cookie's worked-example game state.
 *
 * Two seats race to `targetScore`. `tap` scores 1; `boost` scores 3 but each
 * seat only gets a limited number of boosts. First to the target wins.
 *
 * THE STATE-OWNERSHIP RULE (PANEL-AUTHORING.md §3): everything in `GameState`
 * is authoritative and replayable — reducing the action log from
 * `createRun(...)` MUST reproduce it bit-for-bit. Determinism rules:
 * no `Date.now()`, no `Math.random()` (derive randomness from `seed`),
 * no `Map`/`Set` in stored state (JSON round-trips through the run store).
 */

export interface PlayerState {
  id: string;
  name: string;
  score: number;
  boostsLeft: number;
}

export interface GameState {
  runId: string;
  seed: number;
  /** Drives host panel layout (screenGroups in the capabilities doc). */
  screen_kind: "duel" | "game_over";
  targetScore: number;
  players: PlayerState[];
  winnerId: string | null;
  /** Count of accepted actions; doubles as a cheap op sequence. */
  turnCount: number;
}

/** Every mutation is one of these, applied through the reducer — never in place. */
export type Action =
  | { kind: "tap"; playerId: string }
  | { kind: "boost"; playerId: string };

/** Events the reducer emits alongside the next state (for logs/animation). */
export type EngineEvent =
  | { kind: "score_changed"; playerId: string; delta: number; score: number }
  | { kind: "boost_spent"; playerId: string; boostsLeft: number }
  | { kind: "game_over"; winnerId: string };

export interface NewRunArgs {
  runId: string;
  seed?: number;
  targetScore?: number;
  players?: { id: string; name?: string }[];
}

export const DEFAULT_TARGET_SCORE = 10;
export const DEFAULT_BOOSTS = 2;

/** Deterministic run mint. The caller supplies `runId` (identity is the host's). */
export function createRun(args: NewRunArgs): GameState {
  const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed as number) : 1;
  const targetScore =
    Number.isFinite(args.targetScore) && (args.targetScore as number) > 0
      ? Math.trunc(args.targetScore as number)
      : DEFAULT_TARGET_SCORE;
  const seats = args.players && args.players.length >= 2
    ? args.players
    : [{ id: "p1", name: "Player 1" }, { id: "p2", name: "Player 2" }];
  return {
    runId: args.runId,
    seed,
    screen_kind: "duel",
    targetScore,
    players: seats.map((seat, index) => ({
      id: seat.id,
      name: seat.name ?? `Player ${index + 1}`,
      score: 0,
      boostsLeft: DEFAULT_BOOSTS,
    })),
    winnerId: null,
    turnCount: 0,
  };
}

/** Structured clone that stays JSON-safe (mirrors the run store's storage). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
