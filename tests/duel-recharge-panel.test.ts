import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRun, DEFAULT_BOOSTS, type Action, type GameState } from "../examples/tally-duel/state.ts";
import { reduce } from "../examples/tally-duel/reducer.ts";
import {
  computeDuelViewModel,
  createDuelPanelServer,
} from "../examples/tally-duel/panel/server.ts";
import { duelPolicy } from "../examples/tally-duel/coop-policy.ts";
import { tallyDuelExample } from "../examples/tally-duel/index.ts";

/**
 * The recharge move as the PANEL sees it: one tool, one derived flag, and two
 * renderers that offer the verb without restating the rule.
 */

function harness(initial: GameState | null = null) {
  let state = initial;
  const dispatched: Action[] = [];
  const server = createDuelPanelServer({
    getState: () => state,
    dispatch: async (runId: string, action: Action) => {
      if (!state || state.runId !== runId) throw new Error(`unknown run: ${runId}`);
      dispatched.push(action);
      state = reduce(state, action).state;
      return { ok: true as const, state };
    },
    mintRun: (next: GameState) => {
      state = next;
      return next;
    },
    policy: duelPolicy,
  });
  return { server, dispatched, current: () => state };
}

/** p1: one boost spent, 4 score — the one seat that may recharge. */
function rechargeableRun(): GameState {
  const base = createRun({ runId: "run-panel", seed: 3, targetScore: 10 });
  return reduce(reduce(base, { kind: "boost", playerId: "p1" }).state, {
    kind: "tap",
    playerId: "p1",
  }).state;
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as {
    players: { id: string; score: number; boostsLeft: number; canRecharge: boolean }[];
  };
}

describe("duel.recharge tool", () => {
  test("is served and on the always-load spine", async () => {
    const { server } = harness();
    expect(server.tools.map((tool) => tool.name)).toContain("duel.recharge");
    expect(tallyDuelExample.alwaysLoadTools).toContain("duel.recharge");
  });

  test("dispatches a recharge action and echoes the fresh view-model", async () => {
    const { server, dispatched } = harness(rechargeableRun());
    const result = await server.callTool("duel.recharge", { playerId: "p1" });

    expect(dispatched).toEqual([{ kind: "recharge", playerId: "p1" }]);
    const vm = structured(result);
    expect(vm.players[0]).toMatchObject({
      id: "p1",
      score: 2,
      boostsLeft: DEFAULT_BOOSTS,
      canRecharge: false,
    });
  });

  test("throws without an active run", async () => {
    const { server } = harness();
    await expect(server.callTool("duel.recharge", {})).rejects.toThrow(/no active run/);
  });
});

describe("canRecharge projection", () => {
  test("follows the reducer's rule per seat", () => {
    const vm = computeDuelViewModel(rechargeableRun());
    if (!vm.active) throw new Error("expected an active view-model");
    expect(vm.players.find((player) => player.id === "p1")!.canRecharge).toBe(true);
    expect(vm.players.find((player) => player.id === "p2")!.canRecharge).toBe(false);
  });

  test("is false for every seat once the run is over", () => {
    const short = createRun({ runId: "run-short", seed: 1, targetScore: 3 });
    const over = reduce(short, { kind: "boost", playerId: "p1" }).state;
    const vm = computeDuelViewModel(over);
    if (!vm.active) throw new Error("expected an active view-model");
    expect(vm.players.every((player) => player.canRecharge === false)).toBe(true);
  });
});

describe("both renderers offer the move", () => {
  const template = readFileSync("examples/tally-duel/panel/template.html", "utf8");
  const native = readFileSync("examples/tally-duel/panels-rn/DuelPanel.tsx", "utf8");

  test("the HTML template wires duel.recharge with a label and a disabled state", () => {
    expect(template).toContain('data-act="duel.recharge"');
    expect(template).toContain("aria-label=");
    expect(template).toContain("!player.canRecharge");
    // The generated wrapper must carry the same document.
    const generated = readFileSync("examples/tally-duel/panel/template.gen.ts", "utf8");
    expect(generated).toContain("duel.recharge");
  });

  test("the native panel wires duel.recharge with an accessibility label and disabled state", () => {
    expect(native).toContain('act("duel.recharge", player.id)');
    expect(native).toContain("accessibilityLabel");
    expect(native).toContain("disabled={!!vm.winner || !player.canRecharge}");
  });
});
