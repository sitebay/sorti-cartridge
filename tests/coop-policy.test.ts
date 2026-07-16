import { describe, expect, test } from "bun:test";
import { COOP_DOMAINS, duelPolicy } from "../src/coop/index.ts";
import { createRun, type GameState } from "../src/game/state.ts";
import { reduce } from "../src/game/reducer.ts";
import type { RoomSnapshot } from "../vendor/sorti-contract/index.ts";

function snapshot(state: GameState | null): RoomSnapshot<GameState | null> {
  return { roomId: "room-1", state, log: [], accepted: [], seats: [] };
}

describe("duel coop policy", () => {
  test("registers the duel domain", () => {
    expect(COOP_DOMAINS.map((entry) => entry.domain)).toEqual(["duel"]);
  });

  test("does not act without a run or after game_over", async () => {
    const policy = duelPolicy();
    expect(policy.shouldAct(snapshot(null) as RoomSnapshot<unknown>, "p2")).toBe(false);
    let state = createRun({ runId: "r", seed: 1, targetScore: 1 });
    state = reduce(state, { kind: "tap", playerId: "p1" }).state;
    expect(policy.shouldAct(snapshot(state) as RoomSnapshot<unknown>, "p2")).toBe(false);
  });

  test("taps when even, boosts when behind, deterministically", async () => {
    const policy = duelPolicy();
    const even = createRun({ runId: "r", seed: 1 });
    const evenDraft = await policy.decide(snapshot(even) as RoomSnapshot<unknown>, "p2");
    expect(evenDraft).toMatchObject({ kind: "tap", decidedBy: "heuristic" });

    let behind = even;
    behind = reduce(behind, { kind: "tap", playerId: "p1" }).state;
    behind = reduce(behind, { kind: "tap", playerId: "p1" }).state;
    const behindDraft = await policy.decide(snapshot(behind) as RoomSnapshot<unknown>, "p2");
    expect(behindDraft).toMatchObject({ kind: "boost" });
    expect(behindDraft!.payload).toEqual({ kind: "boost", playerId: "p2" });
  });
});
