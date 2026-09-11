/**
 * Cloudflare Worker entry — the self-hosted half of the app.
 *
 * Routes:
 *   POST /mcp                                     JSON-RPC (the MCP endpoint)
 *   GET  /.well-known/byo-mcp/capabilities.json   BYO activation document
 *   GET  /.well-known/mcp                         endpoint discovery
 *   GET  /.well-known/mcp/server-card.json        the STATIC surface catalog
 *   GET  /manifest (and /)                        tool/resource inventory
 *
 * There is NO client-engine bundle route. This cartridge does not predict;
 * PANEL-AUTHORING.md "Prediction" says what predicting would require and why
 * none of it is reachable from a BYO cartridge today. Serving a bundle nothing
 * can load is what the removed seam did.
 *
 * State model: the MCP server is created PER REQUEST with an empty run map;
 * we hydrate it from the room's RunDO before dispatch and flush it back
 * after — skipping pure reads (same-fingerprint) so a read can never clobber
 * a concurrent mutation.
 *
 * Room identity rides `params._meta["io.sitebay.sorti/roomId"]` (MCP
 * 2026-07-28). The `mcp-session-id` header is a DEPRECATED fallback for
 * clients that have not migrated, and is still echoed on every response —
 * that echo is how the BYO conformance suite detects which lanes this server
 * acknowledges, so removing it silently costs coverage. An unaddressed
 * request gets a freshly minted id. See `sessionIdFrom`.
 */

import { createMcpServer, type RunRecord } from "../src/mcp/server.ts";
import { buildByoCapabilities, buildPanelManifest, buildServerCard, CARTRIDGE_ID } from "../src/mcp/manifest.ts";
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

/**
 * The MCP 2026-07-28 session-handle lane: `params._meta["io.sitebay.sorti/roomId"]`.
 *
 * Held as a local copy rather than imported, for the same reason sts2-engine
 * holds its own: this worker is a separate deployment from the Sorti monorepo
 * that defines the constant (`packages/sorti-contract/src/mcpSessionMeta.ts`).
 * The two are kept in sync by the BYO conformance suite, which probes the
 * `_meta` and header lanes independently and fails if either stops routing.
 */
const SESSION_META_KEY = "io.sitebay.sorti/roomId";

/** Read a non-empty trimmed string, or null. */
function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** The room handle carried in `params._meta`, if this payload carries one. */
function sessionIdFromMeta(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const params = (payload as { params?: unknown }).params;
  // Positional params are legal JSON-RPC but have nowhere to put `_meta`.
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return nonEmpty((meta as Record<string, unknown>)[SESSION_META_KEY]);
}

/**
 * Resolve the room this request addresses, in the precedence the shared
 * migration contract defines (`sorti-contract/src/mcpSessionMeta.ts`):
 * `_meta` -> `mcp-session-id` header -> `?roomId=` -> a freshly minted id.
 *
 * sts2-engine, the other worked example, has finished this migration and is
 * `_meta`-ONLY as of 2026-07-30 — it cannot read the header at all. This
 * cartridge deliberately keeps the header as a fallback rather than following
 * it there: the Sorti client still dual-sends, and dropping a lane a live
 * client still uses is the failure the contract's scar describes.
 *
 * `_meta` FIRST is the whole point. The 2026-07-28 revision retires
 * protocol-level sessions, so the header is a deprecated fallback kept only
 * for clients that have not migrated. Reading the header first would keep this
 * worker pinned to the dying lane; reading it not at all would break those
 * clients today. The Sorti client sends BOTH during the migration, which is
 * exactly why this order is safe to adopt now and why the two disagreeing must
 * resolve to `_meta`.
 *
 * Minting on a bare request is deliberate: an unaddressed call still gets a
 * private room rather than colliding with someone else's.
 */
function sessionIdFrom(request: Request, url: URL, payload: unknown): string {
  return (
    sessionIdFromMeta(payload) ??
    nonEmpty(request.headers.get("mcp-session-id")) ??
    nonEmpty(url.searchParams.get("roomId")) ??
    crypto.randomUUID()
  );
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
      const sessionId = sessionIdFrom(request, url, payload);
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

    // The card a catalog reads BEFORE it opens a session. Derived from the same
    // panel manifest as `tools/list`, so it can carry neither an omission nor a
    // phantom — the two directions `test-server-card.mjs` fails on. Missing it
    // cost the cartridge one of the suite's seventeen arms.
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return Response.json(buildServerCard(), { headers: CORS_HEADERS });
    }

    if (url.pathname === "/.well-known/byo-mcp/capabilities.json") {
      return Response.json(buildByoCapabilities(), { headers: CORS_HEADERS });
    }

    if ((url.pathname === "/" || url.pathname === "/manifest") && request.method === "GET") {
      return Response.json(buildPanelManifest(), { headers: CORS_HEADERS });
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404, headers: CORS_HEADERS });
  },
};
