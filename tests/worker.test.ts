import { describe, expect, test } from "bun:test";
import worker, { type Env } from "../worker/index.ts";

/** In-memory Durable Object namespace standing in for Cloudflare's RUNS binding. */
function memoryRunsNamespace(): Env["RUNS"] {
  const stores = new Map<string, unknown>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const key = String(id);
        if (url.pathname === "/peek") {
          return Response.json({ ok: true, data: { run: stores.get(key) ?? null } });
        }
        if (url.pathname === "/replace") {
          const body = JSON.parse(String(init?.body)) as { run: unknown };
          stores.set(key, body.run);
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
    headers: {
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

const SESSION_META_KEY = "io.sitebay.sorti/roomId";

/** A tools/call addressed via the MCP 2026-07-28 `_meta` lane. */
function metaCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
  roomId: string | null,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      ...(roomId ? { _meta: { [SESSION_META_KEY]: roomId } } : {}),
    },
  };
}

describe("worker", () => {
  test("serves the BYO capabilities document", async () => {
    const res = await worker.fetch(
      new Request("https://cartridge.test/.well-known/byo-mcp/capabilities.json"),
      {},
    );
    expect(res.status).toBe(200);
    const caps = (await res.json()) as { kind: string; panels: { uri: string }[] };
    expect(caps.kind).toBe("byo-mcp");
    expect(caps.panels.map((panel) => panel.uri)).toEqual(["ui://duel/board", "ui://board/notes"]);
  });

  test("POST /mcp initialize round-trips and mints a session id", async () => {
    const res = await worker.fetch(post({ jsonrpc: "2.0", id: 1, method: "initialize" }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const reply = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(reply.result.serverInfo.name).toBe("sorti-cartridge");
  });

  test("state persists across stateless requests via the RUNS binding", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const session = "room-1";

    await worker.fetch(
      post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "duel.new_run", arguments: { seed: 5 } } }, session),
      env,
    );
    await worker.fetch(
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "duel.tap", arguments: { playerId: "p1" } } }, session),
      env,
    );
    const res = await worker.fetch(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "duel.read_state", arguments: {} } }, session),
      env,
    );
    const reply = (await res.json()) as { result: { structuredContent: { players: { score: number }[] } } };
    expect(reply.result.structuredContent.players[0]!.score).toBe(1);
  });

  test("board runs persist too — appId rides the stored record", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const session = "room-board";
    await worker.fetch(
      post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board.new_board", arguments: {} } }, session),
      env,
    );
    await worker.fetch(
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board.add_note", arguments: { text: "persisted" } } }, session),
      env,
    );
    const res = await worker.fetch(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "board.read_state", arguments: {} } }, session),
      env,
    );
    const reply = (await res.json()) as { result: { structuredContent: { notes: { text: string }[] } } };
    expect(reply.result.structuredContent.notes[0]!.text).toBe("persisted");
  });

  test("sessions are isolated by mcp-session-id", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    await worker.fetch(
      post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "duel.new_run", arguments: {} } }, "room-a"),
      env,
    );
    const res = await worker.fetch(
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "duel.read_state", arguments: {} } }, "room-b"),
      env,
    );
    const reply = (await res.json()) as { result: { structuredContent: { active: boolean } } };
    expect(reply.result.structuredContent.active).toBe(false);
  });

  // MCP 2026-07-28 retires protocol-level sessions: the room handle moves from
  // the `mcp-session-id` header into `params._meta`. These four cases pin the
  // resolution order — without them, the day the header retires this worker
  // does not fail, it silently mints a fresh id per request, addresses an empty
  // Durable Object, and flushes every run into a throwaway.
  describe("room handle resolution", () => {
    test("routes on the `_meta` lane with no session header at all", async () => {
      const env: Env = { RUNS: memoryRunsNamespace() };
      await worker.fetch(post(metaCall(1, "duel.new_run", { seed: 5 }, "room-meta")), env);
      await worker.fetch(post(metaCall(2, "duel.tap", { playerId: "p1" }, "room-meta")), env);
      const res = await worker.fetch(post(metaCall(3, "duel.read_state", {}, "room-meta")), env);

      const reply = (await res.json()) as { result: { structuredContent: { players: { score: number }[] } } };
      expect(reply.result.structuredContent.players[0]!.score).toBe(1);
      // The echo is how the BYO conformance suite detects lane support.
      expect(res.headers.get("mcp-session-id")).toBe("room-meta");
    });

    test("still routes on the deprecated header lane for unmigrated clients", async () => {
      const env: Env = { RUNS: memoryRunsNamespace() };
      await worker.fetch(
        post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "duel.new_run", arguments: {} } }, "room-hdr"),
        env,
      );
      const res = await worker.fetch(
        post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "duel.read_state", arguments: {} } }, "room-hdr"),
        env,
      );
      const reply = (await res.json()) as { result: { structuredContent: { active: boolean } } };
      expect(reply.result.structuredContent.active).toBe(true);
      expect(res.headers.get("mcp-session-id")).toBe("room-hdr");
    });

    test("`_meta` WINS when both lanes disagree", async () => {
      // The Sorti client deliberately sends both during the migration. If the
      // header won, adopting `_meta` would be a no-op and this worker would
      // stay pinned to the dying lane.
      const env: Env = { RUNS: memoryRunsNamespace() };
      const req = new Request("https://cartridge.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "mcp-session-id": "room-header" },
        body: JSON.stringify(metaCall(1, "duel.new_run", { seed: 7 }, "room-meta-wins")),
      });
      const res = await worker.fetch(req, env);
      expect(res.headers.get("mcp-session-id")).toBe("room-meta-wins");

      // Prove it by where the run actually landed: the `_meta` room has it…
      const inMeta = await worker.fetch(post(metaCall(2, "duel.read_state", {}, "room-meta-wins")), env);
      expect(
        ((await inMeta.json()) as { result: { structuredContent: { active: boolean } } }).result.structuredContent
          .active,
      ).toBe(true);
      // …and the header-named room is empty.
      const inHeader = await worker.fetch(
        post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "duel.read_state", arguments: {} } }, "room-header"),
        env,
      );
      expect(
        ((await inHeader.json()) as { result: { structuredContent: { active: boolean } } }).result.structuredContent
          .active,
      ).toBe(false);
    });

    test("mints and echoes a private room when no lane addresses one", async () => {
      const env: Env = { RUNS: memoryRunsNamespace() };
      const res = await worker.fetch(post(metaCall(1, "duel.new_run", {}, null)), env);
      const minted = res.headers.get("mcp-session-id");
      expect(minted).toBeTruthy();
      // An unaddressed call gets its own room rather than colliding with one.
      const elsewhere = await worker.fetch(post(metaCall(2, "duel.read_state", {}, "someone-elses-room")), env);
      expect(
        ((await elsewhere.json()) as { result: { structuredContent: { active: boolean } } }).result.structuredContent
          .active,
      ).toBe(false);
    });

    test("ignores a malformed `_meta` and falls through to the header", async () => {
      const env: Env = { RUNS: memoryRunsNamespace() };
      const req = new Request("https://cartridge.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "mcp-session-id": "room-fallback" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "duel.new_run", arguments: {}, _meta: { [SESSION_META_KEY]: "   " } },
        }),
      });
      const res = await worker.fetch(req, env);
      expect(res.headers.get("mcp-session-id")).toBe("room-fallback");
    });
  });

  // The route this replaces served an ESM bundle at /engine.client.js and the
  // test asserted its BYTES contained the string "REDUCERS". That is an
  // existence check: the bundle it blessed could not be loaded by the host at
  // all (a classic-script `<script src>` load of ESM is a SyntaxError), so a
  // green suite reported a working prediction lane that had never run once.
  // `tests/prediction-seam.test.ts` is the replacement, and it drives the
  // contract instead of grepping for it.
  test("serves no client-engine bundle — the cartridge does not predict", async () => {
    const res = await worker.fetch(new Request("https://cartridge.test/engine.client.js"), {});
    expect(res.status).toBe(404);
  });

  // ── S5b-2: the fifth route the bar asks for ─────────────────────────────
  test("serves a server card that matches tools/list in BOTH directions", async () => {
    const res = await worker.fetch(new Request("https://cartridge.test/.well-known/mcp/server-card.json"), {});
    expect(res.status).toBe(200);
    const card = (await res.json()) as {
      name: string;
      version: string;
      tools: { name: string; inputSchema: unknown }[];
      resources: { uri: string }[];
    };
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.tools.length).toBeGreaterThan(0);
    for (const tool of card.tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.inputSchema).toBe("object");
    }
    const listed = await worker.fetch(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {});
    const served = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map(
      (tool) => tool.name,
    );
    const carded = card.tools.map((tool) => tool.name);
    // An omission hides a live tool from every catalog that reads the card
    // instead of connecting; a phantom offers a button the server refuses.
    expect([...carded].sort()).toEqual([...served].sort());
    expect(new Set(carded).size).toBe(carded.length);
    expect(card.resources.length).toBeGreaterThan(0);
  });

  test("rejects non-JSON-RPC bodies", async () => {
    const res = await worker.fetch(post({ hello: "world" }), {});
    expect(res.status).toBe(400);
  });
});
