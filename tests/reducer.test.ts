import { describe, expect, test } from "bun:test";
import { createRun, DEFAULT_BOOSTS, type Action } from "../src/game/state.ts";
import { legalActions, reduce } from "../src/game/reducer.ts";

const run = () => createRun({ runId: "run-test", seed: 7, targetScore: 5 });

describe("createRun", () => {
  test("is deterministic for the same args", () => {
    expect(createRun({ runId: "r", seed: 3 })).toEqual(createRun({ runId: "r", seed: 3 }));
  });

  test("defaults to two seats with boosts", () => {
    const state = run();
    expect(state.players.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(state.players.every((p) => p.boostsLeft === DEFAULT_BOOSTS)).toBe(true);
    expect(state.screen_kind).toBe("duel");
  });
});

describe("reduce", () => {
  test("tap scores 1 and emits score_changed", () => {
    const before = run();
    const { state, events } = reduce(before, { kind: "tap", playerId: "p1" });
    expect(state.players[0]!.score).toBe(1);
    expect(events).toEqual([{ kind: "score_changed", playerId: "p1", delta: 1, score: 1 }]);
    // purity: input untouched
    expect(before.players[0]!.score).toBe(0);
  });

  test("boost scores 3 and spends a boost", () => {
    const { state, events } = reduce(run(), { kind: "boost", playerId: "p2" });
    expect(state.players[1]!.score).toBe(3);
    expect(state.players[1]!.boostsLeft).toBe(DEFAULT_BOOSTS - 1);
    expect(events.map((e) => e.kind)).toEqual(["boost_spent", "score_changed"]);
  });

  test("boost with none left throws", () => {
    // High target so spending every boost doesn't end the run first.
    let state = createRun({ runId: "run-test", seed: 7, targetScore: 50 });
    for (let i = 0; i < DEFAULT_BOOSTS; i++) state = reduce(state, { kind: "boost", playerId: "p1" }).state;
    expect(() => reduce(state, { kind: "boost", playerId: "p1" })).toThrow(/no boosts left/);
  });

  test("reaching the target ends the run with a winner", () => {
    let state = run(); // target 5
    state = reduce(state, { kind: "boost", playerId: "p1" }).state; // 3
    const final = reduce(state, { kind: "boost", playerId: "p1" }); // 6 >= 5
    expect(final.state.screen_kind).toBe("game_over");
    expect(final.state.winnerId).toBe("p1");
    expect(final.events.at(-1)).toEqual({ kind: "game_over", winnerId: "p1" });
  });

  test("acting after game_over throws", () => {
    let state = run();
    for (let i = 0; i < 5; i++) state = reduce(state, { kind: "tap", playerId: "p1" }).state;
    expect(state.screen_kind).toBe("game_over");
    expect(() => reduce(state, { kind: "tap", playerId: "p2" })).toThrow(/over/);
  });

  test("unknown player throws", () => {
    expect(() => reduce(run(), { kind: "tap", playerId: "ghost" })).toThrow(/unknown player/);
  });

  test("replaying the action log reproduces the final state exactly", () => {
    const log: Action[] = [
      { kind: "tap", playerId: "p1" },
      { kind: "boost", playerId: "p2" },
      { kind: "tap", playerId: "p2" },
      { kind: "tap", playerId: "p1" },
    ];
    let live = run();
    for (const action of log) live = reduce(live, action).state;

    let replayed = run();
    for (const action of log) replayed = reduce(replayed, action).state;

    expect(replayed).toEqual(live);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });
});

describe("legalActions", () => {
  test("offers tap always and boost only while boosts remain", () => {
    const state = run();
    expect(legalActions(state, "p1")).toEqual([
      { kind: "tap", playerId: "p1" },
      { kind: "boost", playerId: "p1" },
    ]);
    let spent = createRun({ runId: "run-test", seed: 7, targetScore: 50 });
    for (let i = 0; i < DEFAULT_BOOSTS; i++) spent = reduce(spent, { kind: "boost", playerId: "p1" }).state;
    expect(legalActions(spent, "p1")).toEqual([{ kind: "tap", playerId: "p1" }]);
  });

  test("empty after game_over", () => {
    let state = run();
    for (let i = 0; i < 5; i++) state = reduce(state, { kind: "tap", playerId: "p1" }).state;
    expect(legalActions(state)).toEqual([]);
  });
});
