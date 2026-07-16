/**
 * Cloudflare Worker entry — the self-hosted half of the app.
 *
 * Routes:
 *   POST /mcp                                     JSON-RPC (the MCP endpoint)
 *   GET  /.well-known/byo-mcp/capabilities.json   BYO activation document
 *   GET  /.well-known/mcp                         endpoint discovery
 *   GET  /manifest (and /)                        tool/resource inventory
 *   GET  /engine.client.js                        client reducer bundle
 *
 * State model: the MCP server is created PER REQUEST with an empty run map;
 * we hydrate it from the session's RunDO before dispatch and flush it back
 * after — skipping pure reads (same-fingerprint) so a read can never clobber
 * a concurrent mutation. Session identity is the `mcp-session-id` header
 * (minted when absent and echoed back).
 */

import { createMcpServer, type RunRecord } from "../src/mcp/server.ts";
import { buildByoCapabilities, buildPanelManifest, CARTRIDGE_ID } from "../src/mcp/manifest.ts";
import { ENGINE_VERSION } from "../src/client-engine/engine-url.ts";
import { ENGINE_CLIENT_JS } from "../src/client-engine/engine-client.generated.ts";
import type { StoredRun } from "./run-do.ts";
export { RunDO } from "./run-do.ts";

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export type Env = {
  RUNS?: DurableObjectNamespaceLike;
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-session-id",
  "access-control-max-age": "86400",
};

function sessionIdFrom(request: Request): string {
  const header = request.headers.get("mcp-session-id");
  if (header && header.trim()) return header.trim();
  return crypto.randomUUID();
}

async function hydrateRuns(env: Env, sessionId: string, runs: Map<string, RunRecord>): Promise<string> {
  if (!env.RUNS) return "";
  const stub = env.RUNS.get(env.RUNS.idFromName(sessionId));
  const res = await stub.fetch("https://do/peek");
  if (!res.ok) return "";
  const body = (await res.json()) as { ok: boolean; data?: { run: StoredRun | null } };
  const run = body.ok ? body.data?.run ?? null : null;
  if (run && run.state && typeof run.state === "object" && typeof run.appId === "string") {
    const state = run.state as RunRecord["state"];
    runs.set(state.runId, {
      appId: run.appId,
      state,
      log: (run.log ?? []) as RunRecord["log"],
    });
  }
  return run ? JSON.stringify(run) : "";
}

async function flushRuns(
  env: Env,
  sessionId: string,
  runs: Map<string, RunRecord>,
  beforeFingerprint: string,
): Promise<void> {
  if (!env.RUNS) return;
  const record = runs.values().next().value ?? null;
  const stored: StoredRun | null = record
    ? { appId: record.appId, state: record.state, log: record.log }
    : null;
  const afterFingerprint = stored ? JSON.stringify(stored) : "";
  // Don't flush pure reads: writing identical state back races concurrent
  // mutations and can resurrect a stale run.
  if (afterFingerprint === beforeFingerprint) return;
  const stub = env.RUNS.get(env.RUNS.idFromName(sessionId));
  if (!stored) {
    await stub.fetch("https://do/clear", { method: "POST" });
    return;
  }
  await stub.fetch("https://do/replace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: stored }),
  });
}

function isJsonRpcPayload(value: unknown): value is Parameters<ReturnType<typeof createMcpServer>["handleJsonRpc"]>[0] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { jsonrpc?: unknown; method?: unknown };
  return candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if ((url.pathname === "/mcp" || url.pathname === "/") && request.method === "POST") {
      const payload: unknown = await request.json();
      if (!isJsonRpcPayload(payload)) {
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      const sessionId = sessionIdFrom(request);
      const server = createMcpServer();
      const beforeFingerprint = await hydrateRuns(env, sessionId, server.runs);
      const reply = await server.handleJsonRpc(payload);
      await flushRuns(env, sessionId, server.runs, beforeFingerprint);
      return Response.json(reply, {
        headers: {
          ...CORS_HEADERS,
          "mcp-session-id": sessionId,
          "access-control-expose-headers": "mcp-session-id",
        },
      });
    }

    if (url.pathname === "/.well-known/mcp") {
      return Response.json({ name: CARTRIDGE_ID, endpoint: "/mcp", manifest: "/manifest" }, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/.well-known/byo-mcp/capabilities.json") {
      return Response.json(buildByoCapabilities(ENGINE_VERSION), { headers: CORS_HEADERS });
    }

    if ((url.pathname === "/" || url.pathname === "/manifest") && request.method === "GET") {
      return Response.json(buildPanelManifest(), { headers: CORS_HEADERS });
    }

    if (url.pathname === "/engine.client.js" && request.method === "GET") {
      return new Response(ENGINE_CLIENT_JS, {
        headers: {
          ...CORS_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          etag: `"${ENGINE_VERSION}"`,
        },
      });
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404, headers: CORS_HEADERS });
  },
};
