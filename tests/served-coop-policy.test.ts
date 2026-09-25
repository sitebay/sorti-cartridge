/**
 * The app SERVES its own agent-seat policy.
 *
 * WHY THIS EXISTS. `coop-policy.test.ts` above proves `duelPolicy()` decides
 * well — but that function only ever reached the Sorti agent one way: an
 * operator pointing `SORTI_COOP_DOMAIN_MODULES` at this repo's `./coop` export.
 * That seam is env-only on purpose (importing a module a remote named is code
 * execution), so it can never be opened to you. Every cartridge deployed
 * anywhere real therefore had its seat played by the platform's generic policy,
 * however much strategy lived in this file.
 *
 * These arms pin the repair: the SAME `duelPolicy()` is also a tool, declared in
 * the capabilities document, called over the MCP wire this app already speaks.
 * The tool is a thin wrapper — the strategy is not written twice.
 */
import { describe, expect, test } from "bun:test";
import worker, { type Env } from "../worker/index.ts";
import { buildByoCapabilities } from "../src/mcp/manifest.ts";
import { duelPolicy } from "../examples/tally-duel/coop-policy.ts";
import { createRun, type GameState } from "../examples/tally-duel/state.ts";
import { reduce } from "../examples/tally-duel/reducer.ts";
import type { RoomSnapshot } from "../vendor/sorti-contract/index.ts";

/** In-memory Durable Object namespace standing in for the RUNS binding. */
function memoryRunsNamespace(): Env["RUNS"] {
  const stores = new Map<string, unknown>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const key = String(id);
        if (url.pathname === "/peek") return Response.json({ ok: true, data: { run: stores.get(key) ?? null } });
        if (url.pathname === "/replace") {
          stores.set(key, (JSON.parse(String(init?.body)) as { run: unknown }).run);
          return Response.json({ ok: true });
        }
        if (url.pathname === "/clear") {
          stores.delete(key);
          return Response.json({ ok: true });
        }
        return Response.json({ ok: false }, { status: 404 });
      },
    }),
  };
}

function post(body: unknown, sessionId?: string): Request {
  return new Request("https://cartridge.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify(body),
  });
}

async function callTool(env: Env, session: string, name: string, args: unknown): Promise<Record<string, unknown>> {
  const res = await worker.fetch(post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session), env);
  const reply = (await res.json()) as { result: Record<string, unknown> };
  return reply.result;
}

function snapshot(state: GameState, roomId = "room-served"): RoomSnapshot<unknown> {
  return { roomId, state, log: [], accepted: [], seats: [] };
}

const DECIDE_TOOL = "duel.coop_policy_decide";

describe("the capabilities document declares the served policy", () => {
  const caps = buildByoCapabilities() as {
    coop?: { domain: string; policy?: { version: string; decideTool: string } };
    modules: { id: string; tools: string[] }[];
  };

  test("the coop block names a versioned decide tool", () => {
    expect(caps.coop?.policy).toEqual({ version: "1", decideTool: DECIDE_TOOL });
  });

  /**
   * A document that promises a tool the app does not answer is exactly the
   * failure the probe-tools work was written to end. The declaration is checked
   * against what this cartridge actually serves, not against a hand-kept list.
   */
  test("the declared tool is one this app actually advertises", () => {
    expect(caps.modules.flatMap((module) => module.tools)).toContain(DECIDE_TOOL);
  });
});

describe("the policy tool over the wire", () => {
  test("tools/list advertises it", async () => {
    const res = await worker.fetch(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {});
    const reply = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(reply.result.tools.map((tool) => tool.name)).toContain(DECIDE_TOOL);
  });

  test("it answers the { ok, data } envelope with the draft duelPolicy decides", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const session = "room-served";
    await callTool(env, session, "duel.new_run", { seed: 5 });

    const state = createRun({ runId: "duel-run-5", seed: 5 });
    const result = await callTool(env, session, DECIDE_TOOL, { roomId: session, seatId: "p2", snapshot: snapshot(state) });
    const envelope = result.structuredContent as { ok: boolean; data: { draft: { kind: string }; attention: unknown } };

    expect(envelope.ok).toBe(true);
    // The SAME answer the in-process policy gives — one strategy, two doors.
    expect(envelope.data.draft).toEqual(await duelPolicy().decide(snapshot(state), "p2") as never);
    expect(envelope.data.draft.kind).toBe("tap");
  });

  test("it carries the attention home in the same reply — the halo costs no second call", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    let behind = createRun({ runId: "duel-run-7", seed: 7 });
    behind = reduce(behind, { kind: "tap", playerId: "p1" }).state;
    behind = reduce(behind, { kind: "tap", playerId: "p1" }).state;

    const result = await callTool(env, "room-behind", DECIDE_TOOL, { roomId: "room-behind", seatId: "p2", snapshot: snapshot(behind, "room-behind") });
    const envelope = result.structuredContent as { ok: boolean; data: { draft: { kind: string }; attention: unknown } };

    expect(envelope.data.draft.kind).toBe("boost");
    expect(envelope.data.attention).toEqual({
      surfaceId: "ui://duel/board",
      anchor: { type: "entityId", entityId: "p2" },
    });
  });

  test("a seat this run does not have is a pass, not an error", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const state = createRun({ runId: "duel-run-9", seed: 9 });
    const result = await callTool(env, "room-stranger", DECIDE_TOOL, { roomId: "room-stranger", seatId: "p9", snapshot: snapshot(state, "room-stranger") });
    const envelope = result.structuredContent as { ok: boolean; data: { draft: unknown } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.draft).toBeNull();
  });

  test("a call with no snapshot passes rather than throwing — a held tick beats a wedged seat", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const result = await callTool(env, "room-empty", DECIDE_TOOL, { roomId: "room-empty", seatId: "p2" });
    const envelope = result.structuredContent as { ok: boolean; data: { draft: unknown } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.draft).toBeNull();
  });
});

/**
 * THE PLAN CROSSES THE SAME WIRE AS THE BOARD.
 *
 * Everything else in the request describes the BOARD. `guidance` is the one
 * field that describes the CONVERSATION — the sentence the person and Sorti's
 * chat brain settled on — and without it a served app is the one kind of app
 * whose seat cannot be told the plan.
 */
describe("the decide request carries the chat brain's guidance", () => {
  test("the same board picks differently once the seat is told to go aggressive", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const state = createRun({ runId: "duel-run-11", seed: 11 });

    const plain = await callTool(env, "room-plain", DECIDE_TOOL, {
      roomId: "room-plain",
      seatId: "p2",
      snapshot: snapshot(state, "room-plain"),
    });
    const guided = await callTool(env, "room-guided", DECIDE_TOOL, {
      roomId: "room-guided",
      seatId: "p2",
      snapshot: snapshot(state, "room-guided"),
      guidance: "go aggressive this fight",
    });

    expect((plain.structuredContent as { data: { draft: { kind: string } } }).data.draft.kind).toBe("tap");
    expect((guided.structuredContent as { data: { draft: { kind: string } } }).data.draft.kind).toBe("boost");
  });

  test("the tool declares the field, so a maker can see it without reading this source", () => {
    const caps = buildByoCapabilities() as { coop?: { policy?: { decideTool: string } } };
    expect(caps.coop?.policy?.decideTool).toBe(DECIDE_TOOL);
  });
});
