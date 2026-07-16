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
  return new Request("https://cookie.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("worker", () => {
  test("serves the BYO capabilities document", async () => {
    const res = await worker.fetch(
      new Request("https://cookie.test/.well-known/byo-mcp/capabilities.json"),
      {},
    );
    expect(res.status).toBe(200);
    const caps = (await res.json()) as { kind: string; panels: { uri: string }[] };
    expect(caps.kind).toBe("byo-mcp");
    expect(caps.panels[0]!.uri).toBe("ui://duel/board");
  });

  test("POST /mcp initialize round-trips and mints a session id", async () => {
    const res = await worker.fetch(post({ jsonrpc: "2.0", id: 1, method: "initialize" }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const reply = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(reply.result.serverInfo.name).toBe("sorti-game-cookie");
  });

  test("state persists across stateless requests via the RUNS binding", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    const session = "room-1";

    await worker.fetch(
      post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "new_run", arguments: { seed: 5 } } }, session),
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

  test("sessions are isolated by mcp-session-id", async () => {
    const env: Env = { RUNS: memoryRunsNamespace() };
    await worker.fetch(
      post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "new_run", arguments: {} } }, "room-a"),
      env,
    );
    const res = await worker.fetch(
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "duel.read_state", arguments: {} } }, "room-b"),
      env,
    );
    const reply = (await res.json()) as { result: { structuredContent: { active: boolean } } };
    expect(reply.result.structuredContent.active).toBe(false);
  });

  test("serves the client engine bundle", async () => {
    const res = await worker.fetch(new Request("https://cookie.test/engine.client.js"), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("reduceOne");
  });

  test("rejects non-JSON-RPC bodies", async () => {
    const res = await worker.fetch(post({ hello: "world" }), {});
    expect(res.status).toBe(400);
  });
});
