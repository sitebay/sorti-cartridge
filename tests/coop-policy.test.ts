import { describe, expect, test } from "bun:test";
import { COOP_DOMAINS } from "../src/coop/index.ts";
import { duelPolicy } from "../examples/tally-duel/coop-policy.ts";
import { boardTidyPolicy } from "../examples/board/coop-policy.ts";
import { createRun, type GameState } from "../examples/tally-duel/state.ts";
import { reduce as duelReduce } from "../examples/tally-duel/reducer.ts";
import { createBoard, type BoardState } from "../examples/board/state.ts";
import { reduce as boardReduce } from "../examples/board/reducer.ts";
import type { RoomSnapshot } from "../vendor/sorti-contract/index.ts";

function snapshot<S>(state: S): RoomSnapshot<S> {
  return { roomId: "room-1", state, log: [], accepted: [], seats: [] };
}

describe("coop domain registration", () => {
  test("every example registers its domain through the one seam", () => {
    expect(COOP_DOMAINS.map((entry) => entry.domain)).toEqual(["tally-duel", "board"]);
    for (const entry of COOP_DOMAINS) {
      expect(typeof entry.factory).toBe("function");
    }
  });
});

describe("duel coop policy", () => {
  test("does not act without a run or after game_over", async () => {
    const policy = duelPolicy();
    expect(policy.shouldAct(snapshot<GameState | null>(null) as RoomSnapshot<unknown>, "p2")).toBe(false);
    let state = createRun({ runId: "r", seed: 1, targetScore: 1 });
    state = duelReduce(state, { kind: "tap", playerId: "p1" }).state;
    expect(policy.shouldAct(snapshot(state) as RoomSnapshot<unknown>, "p2")).toBe(false);
  });

  test("taps when even, boosts when behind, deterministically", async () => {
    const policy = duelPolicy();
    const even = createRun({ runId: "r", seed: 1 });
    const evenDraft = await policy.decide(snapshot(even) as RoomSnapshot<unknown>, "p2");
    expect(evenDraft).toMatchObject({ kind: "tap", decidedBy: "heuristic" });

    let behind = even;
    behind = duelReduce(behind, { kind: "tap", playerId: "p1" }).state;
    behind = duelReduce(behind, { kind: "tap", playerId: "p1" }).state;
    const behindDraft = await policy.decide(snapshot(behind) as RoomSnapshot<unknown>, "p2");
    expect(behindDraft).toMatchObject({ kind: "boost" });
    expect(behindDraft!.payload).toEqual({ kind: "boost", playerId: "p2" });
  });
});

describe("board tidy policy", () => {
  test("passes on an empty or tidy board", async () => {
    const policy = boardTidyPolicy();
    expect(policy.shouldAct(snapshot<BoardState | null>(null) as RoomSnapshot<unknown>, "p2")).toBe(false);
    let tidy = createBoard({ runId: "b", seed: 1 });
    tidy = boardReduce(tidy, { kind: "add_note", text: "aligned", x: 40, y: 60 }).state;
    expect(policy.shouldAct(snapshot(tidy) as RoomSnapshot<unknown>, "p2")).toBe(false);
    expect(await policy.decide(snapshot(tidy) as RoomSnapshot<unknown>, "p2")).toBeNull();
  });

  test("snaps the first off-grid note to the grid, one op per tick", async () => {
    const policy = boardTidyPolicy();
    let messy = createBoard({ runId: "b", seed: 1 });
    messy = boardReduce(messy, { kind: "add_note", text: "askew", x: 47, y: 73 }).state;
    expect(policy.shouldAct(snapshot(messy) as RoomSnapshot<unknown>, "p2")).toBe(true);
    const draft = await policy.decide(snapshot(messy) as RoomSnapshot<unknown>, "p2");
    expect(draft).toMatchObject({ kind: "move_note", decidedBy: "heuristic", tier: "act" });
    expect(draft!.payload).toEqual({ kind: "move_note", noteId: "n1", x: 40, y: 80 });
    // Applying the op makes the board tidy — the loop terminates.
    const applied = boardReduce(messy, draft!.payload as never).state;
    expect(policy.shouldAct(snapshot(applied) as RoomSnapshot<unknown>, "p2")).toBe(false);
  });
});

describe("policy attention — the declared half of presence (sts2 4c985b0f)", () => {
  test("the duel seat scopes its attention to its own panel and the target seat", () => {
    const policy = duelPolicy();
    const state = createRun({ runId: "r", seed: 1, targetScore: 9 });
    const draft = policy.decide(snapshot(state) as RoomSnapshot<unknown>, "p2");
    expect(draft).not.toBeNull();
    const attention = policy.attention?.(draft as never, snapshot(state) as RoomSnapshot<unknown>, "p2");
    expect(attention).toEqual({
      surfaceId: "ui://duel/board",
      anchor: { type: "entityId", entityId: "p2" },
    });
  });

  test("the board seat anchors on the note it is about to move", () => {
    const policy = boardTidyPolicy();
    let state = createBoard({ runId: "b", seed: 1 });
    state = boardReduce(state, { kind: "add_note", text: "off grid" }).state as BoardState;
    state = boardReduce(state, { kind: "move_note", noteId: state.notes[0]!.id, x: 33, y: 47 })
      .state as BoardState;
    const draft = policy.decide(snapshot(state) as RoomSnapshot<unknown>, "seat-2");
    expect(draft).not.toBeNull();
    const attention = policy.attention?.(draft as never, snapshot(state) as RoomSnapshot<unknown>, "seat-2");
    expect(attention).toEqual({
      surfaceId: "ui://board/notes",
      anchor: { type: "entityId", entityId: state.notes[0]!.id },
    });
  });

  test("attention is pure, synchronous, and null for an op with no visible target", () => {
    const policy = boardTidyPolicy();
    const state = createBoard({ runId: "b", seed: 1 });
    const before = JSON.stringify(state);
    const result = policy.attention?.(
      { kind: "not_a_move", payload: {} } as never,
      snapshot(state) as RoomSnapshot<unknown>,
      "seat-2",
    );
    expect(result).toBeNull();
    expect(JSON.stringify(state)).toBe(before);
  });
});
