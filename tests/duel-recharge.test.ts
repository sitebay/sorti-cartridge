import { describe, expect, test } from "bun:test";
import { createRun, DEFAULT_BOOSTS, type Action, type GameState } from "../examples/tally-duel/state.ts";
import { legalActions, reduce } from "../examples/tally-duel/reducer.ts";

/**
 * Recharge — the move that trades 2 score for 1 boost. Everything here is
 * reducer-level: the rule has exactly one owner (examples/tally-duel/reducer.ts)
 * and these tests pin both halves of it, the mutation and the derivation.
 */

const run = () => createRun({ runId: "run-recharge", seed: 7, targetScore: 10 });

/** A seat with score to spend and room to take a boost back. */
function rechargeable(): GameState {
  const state = reduce(reduce(run(), { kind: "boost", playerId: "p1" }).state, {
    kind: "tap",
    playerId: "p1",
  }).state;
  expect(state.players[0]!.score).toBe(4);
  expect(state.players[0]!.boostsLeft).toBe(DEFAULT_BOOSTS - 1);
  return state;
}

describe("reduce(recharge)", () => {
  test("spends exactly 2 score for exactly 1 boost and ticks turnCount once", () => {
    const before = rechargeable();
    const { state, events } = reduce(before, { kind: "recharge", playerId: "p1" });

    expect(state.players[0]!.score).toBe(before.players[0]!.score - 2);
    expect(state.players[0]!.boostsLeft).toBe(before.players[0]!.boostsLeft + 1);
    expect(state.turnCount).toBe(before.turnCount + 1);
    expect(events).toEqual([
      { kind: "score_changed", playerId: "p1", delta: -2, score: 2 },
      { kind: "boost_recharged", playerId: "p1", score: 2, boostsLeft: DEFAULT_BOOSTS },
    ]);
  });

  test("never mutates the input state", () => {
    const before = rechargeable();
    const snapshot = structuredClone(before);
    reduce(before, { kind: "recharge", playerId: "p1" });
    expect(before).toEqual(snapshot);
  });

  test("leaves the opponent, target, winner, seed and run identity alone", () => {
    const before = rechargeable();
    const { state } = reduce(before, { kind: "recharge", playerId: "p1" });

    expect(state.players[1]).toEqual(before.players[1]!);
    expect(state.targetScore).toBe(before.targetScore);
    expect(state.winnerId).toBeNull();
    expect(state.screen_kind).toBe("duel");
    expect(state.seed).toBe(before.seed);
    expect(state.runId).toBe(before.runId);
  });

  test("rejects a seat that cannot pay 2 score", () => {
    const poor = reduce(run(), { kind: "tap", playerId: "p1" }).state;
    expect(poor.players[0]!.score).toBe(1);
    expect(() => reduce(poor, { kind: "recharge", playerId: "p1" })).toThrow(/needs 2 score/);
  });

  test("rejects a seat already at the initial boost allowance", () => {
    const full = reduce(reduce(run(), { kind: "tap", playerId: "p1" }).state, {
      kind: "tap",
      playerId: "p1",
    }).state;
    expect(full.players[0]!.boostsLeft).toBe(DEFAULT_BOOSTS);
    expect(() => reduce(full, { kind: "recharge", playerId: "p1" })).toThrow(/full boost allowance/);
  });

  test("rejects an unknown player", () => {
    expect(() => reduce(rechargeable(), { kind: "recharge", playerId: "nobody" })).toThrow(
      /unknown player/,
    );
  });

  test("rejects a completed game", () => {
    const short = createRun({ runId: "run-short", seed: 1, targetScore: 3 });
    const over = reduce(short, { kind: "boost", playerId: "p1" }).state;
    expect(over.screen_kind).toBe("game_over");
    expect(() => reduce(over, { kind: "recharge", playerId: "p1" })).toThrow(/is over/);
  });

  test("a rejected recharge leaves the state untouched", () => {
    const before = run();
    const snapshot = structuredClone(before);
    expect(() => reduce(before, { kind: "recharge", playerId: "p1" })).toThrow();
    expect(before).toEqual(snapshot);
  });
});

describe("legalActions(recharge)", () => {
  const kinds = (state: GameState, playerId?: string) =>
    legalActions(state, playerId).map((action) => action.kind);

  test("is absent at a full allowance and absent below 2 score", () => {
    expect(kinds(run(), "p1")).not.toContain("recharge");
    const oneTap = reduce(run(), { kind: "tap", playerId: "p1" }).state;
    expect(kinds(oneTap, "p1")).not.toContain("recharge");
  });

  test("appears exactly at score 2 with a spent boost, and only for that seat", () => {
    const state = reduce(reduce(run(), { kind: "boost", playerId: "p1" }).state, {
      kind: "recharge",
      playerId: "p1",
    }).state;
    // p1 is back to a full allowance with 1 score — no recharge for them.
    expect(kinds(state, "p1")).not.toContain("recharge");

    const boosted = reduce(rechargeable(), { kind: "boost", playerId: "p2" }).state;
    expect(boosted.players[1]!.score).toBe(3);
    expect(boosted.players[1]!.boostsLeft).toBe(DEFAULT_BOOSTS - 1);
    expect(legalActions(boosted, "p2")).toContainEqual({ kind: "recharge", playerId: "p2" });
    expect(kinds(boosted, "p1")).toContain("recharge");
  });

  test("is empty once the run is over", () => {
    const short = createRun({ runId: "run-short", seed: 1, targetScore: 3 });
    const over = reduce(short, { kind: "boost", playerId: "p1" }).state;
    expect(legalActions(over)).toEqual([]);
  });
});

describe("replay", () => {
  test("an action log containing recharge replays bit-for-bit", () => {
    const log: Action[] = [
      { kind: "boost", playerId: "p1" },
      { kind: "tap", playerId: "p2" },
      { kind: "recharge", playerId: "p1" },
      { kind: "tap", playerId: "p1" },
      { kind: "boost", playerId: "p1" },
    ];
    const play = () => log.reduce((state, action) => reduce(state, action).state, run());
    expect(play()).toEqual(play());

    const final = play();
    expect(final.turnCount).toBe(log.length);
    expect(final.players[0]!.score).toBe(3 - 2 + 1 + 3);
    expect(final.players[0]!.boostsLeft).toBe(DEFAULT_BOOSTS - 1);
  });
});
