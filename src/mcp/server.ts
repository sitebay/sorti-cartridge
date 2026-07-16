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
import type { CartridgeExample, RunStateBase } from "./example-contract.ts";
import { createPanelRegistry, type PanelRegistry } from "./panels/registry.ts";
import type { PanelServer } from "../../vendor/sorti-contract/index.ts";

export const SERVER_NAME = "sorti-cartridge";
export const SERVER_VERSION = "0.1.0";

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
    mintRun: (state: RunStateBase): unknown => {
      // Single-run-per-session (like the reference app): minting resets.
      runs.clear();
      runs.set(state.runId, { appId: example.id, state, log: [] });
      return structuredClone(state);
    },
  });

  const panelServers: PanelServer[] = EXAMPLES.flatMap((example) =>
    example.createPanels(runtimeDepsFor(example)),
  );
  const panels = createPanelRegistry(panelServers);

  const toolList = () =>
    panels.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool._meta ? { _meta: tool._meta } : {}),
    }));

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
