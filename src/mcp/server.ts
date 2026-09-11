/**
 * The cartridge's MCP server: raw JSON-RPC over whatever transport the
 * deployment provides (the Cloudflare Worker in worker/index.ts POSTs
 * request bodies here). No SDK dependency — the method surface a Sorti host
 * needs is small:
 *
 *   initialize, tools/list, tools/call, resources/list, resources/read
 *
 * Chassis code: it knows NOTHING about any particular example. Examples
 * register in `examples/index.ts`; the server binds each one its own
 * reducer-backed dispatch + mint and aggregates every panel into one
 * registry. State model (mirrors the reference app): the server object is
 * rebuilt per request; `runs` is the in-memory run map the transport
 * hydrates from and flushes back to durable storage. The action log rides
 * next to each run so replay can reproduce state.
 */

import { EXAMPLES } from "../../examples/index.ts";
import type { CartridgeExample, MintOptions, RunStateBase } from "./example-contract.ts";
import { createPanelRegistry, type PanelRegistry } from "./panels/registry.ts";
import { SORTI_META_NAMESPACE, type PanelServer } from "../../vendor/sorti-contract/index.ts";
import { isAlwaysLoadTool } from "./alwaysLoad.ts";

export const SERVER_NAME = "sorti-cartridge";
export const SERVER_VERSION = "0.1.0";

/**
 * The `_meta` key a defer-by-default client reads to keep a tool in the
 * upfront prompt. Held as a literal rather than imported: it is Anthropic's
 * key, not Sorti's, and it rides the wire verbatim.
 */
export const ALWAYS_LOAD_META_KEY = "anthropic/alwaysLoad" as const;

/**
 * THE SECOND CHANNEL FOR "WHICH PANEL IS LIVE" (lifted from sts2-engine
 * 1ea37353).
 *
 * ⛔ THE ACTIVE-PANEL SET RODE ONE WIRE, AND THAT WIRE CAN DROP. A host learns
 * which panels to mount from `resources/list` plus the `list_changed`
 * NOTIFICATION. If the notification lane is down — a worker reload, a wifi
 * handover, a phone waking — the host keeps the OLD panel mounted and the
 * server has no other way to correct it. In sts2 that showed up as "Not in
 * combat" rendered on the reward screen: the previous panel's own inactive
 * arm, painted because the host never learned the screen had moved.
 *
 * So every tool-call RESULT carries the set too. A reply to your own POST is
 * the one channel that cannot silently fail: if you got an answer, you got
 * this with it. A client that reads it reconciles its mounts on ANY call,
 * with no stream at all.
 *
 * ⛔ ADDITIVE AND HINT-ONLY. It rides `_meta` under the sorti namespace,
 * changes no existing field, and a host that ignores it behaves exactly as it
 * does today.
 */
export function withActivePanels<T>(result: T, active: readonly string[]): T {
  // ⛔ `typeof [] === "object"`, SO THE ARRAY CASE NEEDS ITS OWN GUARD. A tool
  // that answers with an array would be object-spread into `{0:…,1:…,_meta}`
  // and reach the client as a non-array where it expected one, with nothing
  // erroring anywhere. A hint that cannot ride is simply not added — this
  // decoration is additive by contract.
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const bag = result as unknown as { _meta?: Record<string, unknown> };
  const existing = (bag._meta?.[SORTI_META_NAMESPACE] ?? {}) as Record<string, unknown>;
  return {
    ...(result as Record<string, unknown>),
    _meta: { ...(bag._meta ?? {}), [SORTI_META_NAMESPACE]: { ...existing, activePanels: [...active] } },
  } as unknown as T;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface RunRecord {
  /** Which example minted (and therefore reduces) this run. */
  appId: string;
  state: RunStateBase;
  /** Ordered action log — replaying it through the app's reducer reproduces `state`. */
  log: unknown[];
}

export interface McpServer {
  /** Hydrated by the transport before dispatch, flushed after. */
  runs: Map<string, RunRecord>;
  panels: PanelRegistry;
  handleJsonRpc(request: JsonRpcRequest): Promise<unknown>;
}

/** Agent-facing operating manual, returned from `initialize.instructions`. */
export function buildServerInstructions(): string {
  const apps = EXAMPLES.map((example) => `${example.displayName}: ${example.instructions}`);
  return [
    `This cartridge mounts ${EXAMPLES.length} app(s); one run is active per session,`,
    "owned by whichever app minted it (an app's read_state reports inactive while",
    "another app's run is live). Always read state before acting.",
    ...apps,
  ].join(" ");
}

export function createMcpServer(): McpServer {
  const runs = new Map<string, RunRecord>();
  /**
   * Which PRESS minted the live run. Overwritten — never merged — because one
   * session holds one run, so one live kickoff. See `MintOptions.kickoffId`.
   *
   * A cartridge worker rebuilds this server per request, so a deployment whose
   * runs outlive a request must carry this pair beside the run it hydrates
   * (the same reason sts2 keeps its kickoff on the lobby blob rather than in a
   * closure — a memory-only record matches in every in-process test and never
   * in production).
   */
  let embarkKickoff: { kickoffId: string; runId: string } | null = null;

  /** Bind the chassis runtime deps to one example. */
  const runtimeDepsFor = (example: CartridgeExample) => ({
    getActiveState: (): unknown | null => {
      const record: RunRecord | undefined = runs.values().next().value;
      return record && record.appId === example.id ? record.state : null;
    },
    dispatch: async (runId: string, action: unknown): Promise<{ ok: true; state: unknown }> => {
      const record = runs.get(runId);
      if (!record) throw new Error(`unknown run: ${runId}`);
      if (record.appId !== example.id) {
        throw new Error(`run ${runId} belongs to ${record.appId}, not ${example.id}`);
      }
      const result = example.reduce(record.state, action);
      record.state = result.state as RunStateBase;
      record.log.push(action);
      return { ok: true, state: structuredClone(result.state) };
    },
    mintRun: (state: RunStateBase, options?: MintOptions): unknown => {
      // A REPEAT of the same press resumes the run that press minted, rather
      // than silently throwing it away. See `MintOptions.kickoffId`.
      const kickoffId = options?.kickoffId;
      const live: RunRecord | undefined = runs.values().next().value;
      if (kickoffId && live && embarkKickoff
        && embarkKickoff.kickoffId === kickoffId
        && embarkKickoff.runId === live.state.runId) {
        return structuredClone(live.state);
      }
      // Single-run-per-session (like the reference app): minting resets.
      runs.clear();
      runs.set(state.runId, { appId: example.id, state, log: [] });
      // Record which press minted this run, and forget any prior press.
      embarkKickoff = kickoffId ? { kickoffId, runId: state.runId } : null;
      return structuredClone(state);
    },
  });

  /** appId → the panel URIs that example serves (built once, with the servers). */
  const urisByExample = new Map<string, string[]>();
  const panelServers: PanelServer[] = EXAMPLES.flatMap((example) => {
    const servers = example.createPanels(runtimeDepsFor(example));
    urisByExample.set(example.id, servers.map((server) => server.resource.uri));
    return servers;
  });
  const panels = createPanelRegistry(panelServers);

  /**
   * The panels the host should have mounted right now: every panel belonging
   * to the example that owns the live run, or — with no run — every panel this
   * cartridge serves, because nothing has claimed the surface yet.
   *
   * ONE derivation, two carriers: this is the same answer a host would compute
   * from `resources/list` plus each panel's `active` flag, stamped onto results
   * so it survives a dead notification lane. See {@link withActivePanels}.
   */
  const activePanelUris = (): string[] => {
    const live: RunRecord | undefined = runs.values().next().value;
    const uris = (live ? urisByExample.get(live.appId) : undefined)
      ?? panels.listResources().map((resource) => resource.uri);
    return [...uris].sort();
  };

  /**
   * Merge the always-load stamp into a tool's own `_meta` — never overwrite
   * it. The predicate is `alwaysLoad.ts`'s, which is also what the
   * capabilities document filters with: ONE answer, two carriers.
   */
  const withEntrypointMeta = (
    name: string,
    existing: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!isAlwaysLoadTool(name)) return existing;
    return { ...(existing ?? {}), [ALWAYS_LOAD_META_KEY]: true };
  };

  const toolList = () =>
    panels.tools.map((tool) => {
      const meta = withEntrypointMeta(tool.name, tool._meta as Record<string, unknown> | undefined);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    });

  return {
    runs,
    panels,
    async handleJsonRpc(request: JsonRpcRequest): Promise<unknown> {
      // Notifications (no id) get no response body.
      if (request.id === undefined && request.method.startsWith("notifications/")) {
        return null;
      }

      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            capabilities: { tools: {}, resources: { listChanged: true } },
            instructions: buildServerInstructions(),
          },
        };
      }

      if (request.method === "tools/list") {
        return { jsonrpc: "2.0", id: request.id, result: { tools: toolList() } };
      }

      if (request.method === "tools/call") {
        const name = request.params?.name;
        const args = recordOrEmpty(request.params?.arguments);
        try {
          if (typeof name === "string" && panels.tools.some((tool) => tool.name === name)) {
            const result = await panels.callTool(name, args);
            // AFTER the call: a mint or an action may have moved the set, and
            // the whole point is that the reply carries the CURRENT answer.
            return { jsonrpc: "2.0", id: request.id, result: withActivePanels(result, activePanelUris()) };
          }
          // Unknown TOOL is a tool-level error, not a missing METHOD.
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{ type: "text", text: `Error: unknown tool "${String(name)}"` }],
              isError: true,
            },
          };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{ type: "text", text: `Error: ${(err as Error).message ?? String(err)}` }],
              isError: true,
            },
          };
        }
      }

      if (request.method === "resources/list") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            resources: panels.listResources().map((resource) => ({
              uri: resource.uri,
              name: resource.name,
              ...(resource.description ? { description: resource.description } : {}),
              mimeType: resource.mimeType,
              schemaVersion: 2,
              ...(resource._meta ? { _meta: resource._meta } : {}),
            })),
          },
        };
      }

      if (request.method === "resources/read") {
        const uri = typeof request.params?.uri === "string" ? request.params.uri : undefined;
        if (!uri) {
          return {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32602, message: "resources/read requires uri" },
          };
        }
        const content = panels.getResourceContent(uri);
        if (!content) {
          return {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32602, message: `unknown resource: ${uri}` },
          };
        }
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            contents: [{
              uri: content.uri,
              mimeType: content.mimeType,
              schemaVersion: 2,
              text: content.text ?? "",
              ...(content._meta ? { _meta: content._meta } : {}),
            }],
          },
        };
      }

      if (request.method === "ping") {
        return { jsonrpc: "2.0", id: request.id, result: {} };
      }

      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
    },
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
