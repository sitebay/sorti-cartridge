import { describe, expect, test } from "bun:test";
import { createRun, type Action, type GameState } from "../examples/tally-duel/state.ts";
import { reduce } from "../examples/tally-duel/reducer.ts";
import {
  DUEL_PANEL_RESOURCE_URI,
  computeDuelViewModel,
  createDuelPanelServer,
} from "../examples/tally-duel/panel/server.ts";
import { duelPolicy } from "../examples/tally-duel/coop-policy.ts";
import {
  MCP_APP_RESOURCE_MIME_TYPE,
  SORTI_META_NAMESPACE,
} from "../vendor/sorti-contract/index.ts";

function harness(initial: GameState | null = null) {
  let state = initial;
  const dispatched: Action[] = [];
  const server = createDuelPanelServer({
    getState: () => state,
    dispatch: async (runId: string, action: Action) => {
      if (!state || state.runId !== runId) throw new Error(`unknown run: ${runId}`);
      dispatched.push(action);
      state = reduce(state, action).state;
      return { ok: true, state };
    },
    mintRun: (next: GameState) => {
      state = next;
      return structuredClone(next);
    },
    policy: duelPolicy(),
  });
  return { server, dispatched, getState: () => state };
}

describe("duel panel contract", () => {
  test("read_state is pure and returns the inactive VM without a run", async () => {
    const { server, dispatched } = harness(null);
    const result = await server.callTool("duel.read_state", {});
    expect(result.structuredContent).toEqual({ kind: "duel", active: false, reason: "no run" });
    expect(dispatched).toHaveLength(0);
  });

  test("read_state projects a self-contained JSON view model", async () => {
    const { server } = harness(createRun({ runId: "r1", seed: 1, targetScore: 8 }));
    const result = await server.callTool("duel.read_state", {});
    const vm = result.structuredContent as Record<string, unknown>;
    expect(vm).toEqual({
      kind: "duel",
      active: true,
      runId: "r1",
      targetScore: 8,
      players: [
        { id: "p1", name: "Player 1", score: 0, boostsLeft: 2 },
        { id: "p2", name: "Player 2", score: 0, boostsLeft: 2 },
      ],
      winner: null,
    });
    // JSON-serializable and deterministic (no Date/Map/Set/functions).
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
  });

  test("duel.new_run mints through the injected mintRun", async () => {
    const { server, getState } = harness(null);
    const result = await server.callTool("duel.new_run", { seed: 9, targetScore: 4 });
    const value = result.structuredContent as { ok: boolean; runId: string };
    expect(value.ok).toBe(true);
    expect(value.runId).toBe("duel-run-9");
    expect(getState()!.targetScore).toBe(4);
  });

  test("action tools mutate through dispatch and echo the fresh VM", async () => {
    const { server, dispatched, getState } = harness(createRun({ runId: "r1", seed: 1 }));
    const result = await server.callTool("duel.tap", { playerId: "p2" });
    expect(dispatched).toEqual([{ kind: "tap", playerId: "p2" }]);
    expect(getState()!.players[1]!.score).toBe(1);
    const vm = result.structuredContent as { players: { id: string; score: number }[] };
    expect(vm.players[1]!.score).toBe(1);
  });

  test("boost spends the seat's boost via the reducer", async () => {
    const { server, getState } = harness(createRun({ runId: "r1", seed: 1 }));
    await server.callTool("duel.boost", { playerId: "p1" });
    expect(getState()!.players[0]!).toMatchObject({ score: 3, boostsLeft: 1 });
  });

  test("action without an active run throws", async () => {
    const { server } = harness(null);
    await expect(server.callTool("duel.tap", {})).rejects.toThrow(/no active run/);
  });

  test("readResource serves the HTML template with the MCP App mime + layout meta", async () => {
    const { server } = harness(null);
    const content = await server.readResource(DUEL_PANEL_RESOURCE_URI);
    expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME_TYPE);
    expect(content.text).toContain("<!doctype html>");
    expect(content.text).toContain("window.SortiPanel");
    const meta = content._meta?.[SORTI_META_NAMESPACE] as { layout?: { slot?: string } };
    expect(meta.layout?.slot).toBe("main");
    await expect(server.readResource("ui://duel/nope")).rejects.toThrow(/unknown resource/);
  });

  test("tool names follow the <panel>.read_state convention", () => {
    const { server } = harness(null);
    const names = server.tools.map((tool) => tool.name);
    expect(names).toEqual([
      "duel.read_state",
      "duel.new_run",
      "duel.legal_actions",
      "duel.tap",
      "duel.boost",
      // The agent seat's lane: this app serves its own policy rather than
      // relying on an operator's env to hand the platform its code.
      "duel.coop_policy_decide",
    ]);
  });

  test("game_over projects the winner", () => {
    let state = createRun({ runId: "r1", seed: 1, targetScore: 1 });
    state = reduce(state, { kind: "tap", playerId: "p1" }).state;
    const vm = computeDuelViewModel(state);
    expect(vm).toMatchObject({ active: true, winner: { id: "p1", name: "Player 1" } });
  });
});
