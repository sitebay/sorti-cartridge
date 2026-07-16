/**
 * The app's MCP server: raw JSON-RPC over whatever transport the deployment
 * provides (the Cloudflare Worker in worker/index.ts POSTs request bodies
 * here). No SDK dependency — the method surface a Sorti host needs is small:
 *
 *   initialize, tools/list, tools/call, resources/list, resources/read
 *
 * State model (mirrors the reference app): the server object is rebuilt per
 * request; `runs` is the in-memory run map the transport hydrates from and
 * flushes back to durable storage. The action log rides next to each run so
 * replay can reproduce state (see tests/mcp-server.test.ts).
 */

import { createRun, type Action, type GameState } from "../game/state.ts";
import { legalActions, reduce } from "../game/reducer.ts";
import { createPanelRegistry, type PanelRegistry } from "./panels/registry.ts";
import type { PanelToolDefinition } from "../../vendor/sorti-contract/index.ts";

export const SERVER_NAME = "sorti-game-cookie";
export const SERVER_VERSION = "0.1.0";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface RunRecord {
  state: GameState;
  /** Ordered action log — replaying it from createRun reproduces `state`. */
  log: Action[];
}

export interface McpServer {
  /** Hydrated by the transport before dispatch, flushed after. */
  runs: Map<string, RunRecord>;
  panels: PanelRegistry;
  handleJsonRpc(request: JsonRpcRequest): Promise<unknown>;
}

/** Agent-facing operating manual, returned from `initialize.instructions`. */
export function buildServerInstructions(): string {
  return [
    "Tally Duel — a two-seat race to the target score.",
    "Start with new_run (seed, targetScore, players optional).",
    "Read state with duel.read_state before acting; never act from memory.",
    "Actions: duel.tap scores 1; duel.boost scores 3 and spends one of the seat's limited boosts.",
    "The run ends when a seat reaches targetScore; start a new run to play again.",
  ].join(" ");
}

export function createMcpServer(): McpServer {
  const runs = new Map<string, RunRecord>();
  let runCounter = 0;

  const getActiveState = (): GameState | null => runs.values().next().value?.state ?? null;

  const appendAction = (runId: string, action: Action) => {
    const record = runs.get(runId);
    if (!record) throw new Error(`unknown run: ${runId}`);
    const result = reduce(record.state, action);
    record.state = result.state;
    record.log.push(action);
    return result;
  };

  const panels = createPanelRegistry({
    getRun: (runId) => runs.get(runId)?.state ?? null,
    setRun: (runId, state) => {
      const record = runs.get(runId);
      if (record) record.state = state;
      else runs.set(runId, { state, log: [] });
    },
    appendAction,
    getActiveState,
  });

  // ── engine tools (not owned by any panel) ─────────────────────────────
  const newRun: PanelToolDefinition = {
    name: "new_run",
    description:
      "Start a new Tally Duel run (replaces the session's active run). " +
      "Args: seed?, targetScore?, players? ([{id, name?}], min 2).",
    inputSchema: {
      type: "object",
      properties: {
        seed: { type: "number" },
        targetScore: { type: "number" },
        players: { type: "array" },
      },
    },
    handler: (raw) => {
      const args = (raw ?? {}) as {
        seed?: number;
        targetScore?: number;
        players?: { id: string; name?: string }[];
      };
      // Single-run-per-session (like the reference app): new_run resets.
      runs.clear();
      runCounter += 1;
      const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed!) : 1;
      const state = createRun({
        runId: `run-${seed}-${runCounter}`,
        seed,
        ...(args.targetScore !== undefined ? { targetScore: args.targetScore } : {}),
        ...(args.players ? { players: args.players } : {}),
      });
      runs.set(state.runId, { state, log: [] });
      return { ok: true, runId: state.runId, state };
    },
  };

  const legalActionsTool: PanelToolDefinition = {
    name: "legal_actions",
    description: "List the dispatchable actions for the active run (optionally one seat).",
    inputSchema: { type: "object", properties: { playerId: { type: "string" } } },
    handler: (raw) => {
      const args = (raw ?? {}) as { playerId?: string };
      const state = getActiveState();
      if (!state) return { actions: [] };
      return { actions: legalActions(state, args.playerId) };
    },
  };

  const engineTools = [newRun, legalActionsTool];
  const engineToolNames = new Set(engineTools.map((tool) => tool.name));

  const toolList = () => [
    ...engineTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    ...panels.tools
      .filter((tool) => !engineToolNames.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      })),
  ];

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
          const engineTool = engineTools.find((tool) => tool.name === name);
          if (engineTool) {
            const value = await engineTool.handler(args);
            return {
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [{ type: "text", text: JSON.stringify(value ?? null) }],
                ...(value && typeof value === "object" ? { structuredContent: value } : {}),
              },
            };
          }
          if (typeof name === "string" && panels.tools.some((tool) => tool.name === name)) {
            const result = await panels.callTool(name, args);
            return { jsonrpc: "2.0", id: request.id, result };
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
