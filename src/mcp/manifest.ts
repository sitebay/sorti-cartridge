/**
 * Discovery documents the Worker serves:
 *
 *   - `/manifest` — flat tool + resource inventory (host-agnostic).
 *   - `/.well-known/byo-mcp/capabilities.json` — the BYO-MCP capabilities doc
 *     a Sorti host reads to activate this app. Two things depend on it:
 *       1. The agent's BYO bridge SKIPS any server whose capabilities fail to
 *          load — without this endpoint the app is never activated.
 *       2. Allowed-tool caps are built from `modules[].tools`; a tool missing
 *          here is rejected client-side even if tools/list advertises it.
 */

import { createMcpServer } from "./server.ts";
import { MCP_APP_RESOURCE_MIME_TYPE } from "../../vendor/sorti-contract/index.ts";
import { DUEL_PANEL_RESOURCE_URI } from "./panels/duel/server.ts";

export const APP_ID = "sorti-game-cookie";
export const APP_DISPLAY_NAME = "Tally Duel";

export interface PanelManifest {
  id: string;
  displayName: string;
  endpoint: string;
  resources: { uri: string; name: string; mimeType: string }[];
  contracts: { tools: { name: string; description: string; inputSchema: unknown }[] };
}

export function buildPanelManifest(): PanelManifest {
  // A throwaway server — manifest discovery only needs the static resource +
  // tool advertisements, not live run state.
  const server = createMcpServer();
  const panels = server.panels;
  return {
    id: APP_ID,
    displayName: APP_DISPLAY_NAME,
    endpoint: "/mcp",
    resources: panels
      .listResources()
      .map((resource) => ({ uri: resource.uri, name: resource.name, mimeType: resource.mimeType })),
    contracts: {
      tools: [
        { name: "new_run", description: "Start a new run.", inputSchema: { type: "object" } },
        { name: "legal_actions", description: "List dispatchable actions.", inputSchema: { type: "object" } },
        ...panels.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      ],
    },
  };
}

export interface ByoCapabilities {
  id: string;
  version: string;
  displayName: string;
  kind: "byo-mcp";
  kind_version: "1";
  modules: { id: string; description: string; tools: string[] }[];
  specialists: {
    id: string;
    displayName: string;
    tier: "primary" | "secondary";
    tools: string[];
    requiredMcpServers?: string[];
  }[];
  panels: { uri: string }[];
  /** Per-screen panel layout; absent screens fall back to every panel. */
  screenGroups?: Record<string, string[]>;
  multiplayer: { supported: boolean; transport?: string };
}

/**
 * Group the flat tool list into per-domain capability modules. The domain is
 * the tool-name prefix — `duel.tap` → `duel`, `new_run` → `new` — mirroring
 * how the panel servers are organized. Every tool MUST be claimed by a module
 * (allowed-tool caps are the union of modules[].tools).
 */
function byoModules(toolNames: string[]): { id: string; description: string; tools: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const name of toolNames) {
    const id = name.includes(".") ? name.split(".")[0]! : name.split("_")[0]!;
    const bucket = groups.get(id) ?? [];
    bucket.push(name);
    groups.set(id, bucket);
  }
  return [...groups.entries()].map(([id, tools]) => ({
    id,
    description: `${APP_DISPLAY_NAME} ${id.replace(/_/g, " ")} tools.`,
    tools,
  }));
}

export function buildByoCapabilities(version = "1"): ByoCapabilities {
  const manifest = buildPanelManifest();
  const toolNames = manifest.contracts.tools.map((tool) => tool.name);
  return {
    id: APP_ID,
    version,
    displayName: APP_DISPLAY_NAME,
    kind: "byo-mcp",
    kind_version: "1",
    modules: byoModules(toolNames),
    // Specialists are optional (≤12 tools each when present). The duel has no
    // agent-seat specialist; see src/coop for the policy seam instead.
    specialists: [],
    panels: manifest.resources.map((resource) => ({ uri: resource.uri })),
    screenGroups: {
      duel: [DUEL_PANEL_RESOURCE_URI],
      game_over: [DUEL_PANEL_RESOURCE_URI],
    },
    multiplayer: { supported: false },
  };
}

/** Re-export of the blessed MCP App MIME for legacy call sites. */
export const MCP_APP_MIME = MCP_APP_RESOURCE_MIME_TYPE;
