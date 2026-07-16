/**
 * Discovery documents the Worker serves:
 *
 *   - `/manifest` — flat tool + resource inventory (host-agnostic).
 *   - `/.well-known/byo-mcp/capabilities.json` — the BYO-MCP capabilities doc
 *     a Sorti host reads to activate this cartridge. Two things depend on it:
 *       1. The agent's BYO bridge SKIPS any server whose capabilities fail to
 *          load — without this endpoint the cartridge is never activated.
 *       2. Allowed-tool caps are built from `modules[].tools`; a tool missing
 *          here is rejected client-side even if tools/list advertises it.
 *
 * Chassis code: everything below derives from the examples registered in
 * examples/index.ts — no per-app edits needed here beyond CARTRIDGE_ID /
 * CARTRIDGE_DISPLAY_NAME when you make the template your own.
 */

import { createMcpServer, SERVER_VERSION } from "./server.ts";
import { EXAMPLES } from "../../examples/index.ts";
import { MCP_APP_RESOURCE_MIME_TYPE } from "../../vendor/sorti-contract/index.ts";

export const CARTRIDGE_ID = "sorti-cartridge";
export const CARTRIDGE_DISPLAY_NAME = "Sorti Cartridge";

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
    id: CARTRIDGE_ID,
    displayName: CARTRIDGE_DISPLAY_NAME,
    endpoint: "/mcp",
    resources: panels
      .listResources()
      .map((resource) => ({ uri: resource.uri, name: resource.name, mimeType: resource.mimeType })),
    contracts: {
      tools: panels.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
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
 * the tool-name prefix — `duel.tap` → `duel`, `board.add_note` → `board` —
 * mirroring how the panel servers are organized. Every tool MUST be claimed
 * by a module (allowed-tool caps are the union of modules[].tools) and no
 * module may exceed 20 tools.
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
    description: `${CARTRIDGE_DISPLAY_NAME} ${id.replace(/_/g, " ")} tools.`,
    tools,
  }));
}

export function buildByoCapabilities(version = SERVER_VERSION): ByoCapabilities {
  const manifest = buildPanelManifest();
  const toolNames = manifest.contracts.tools.map((tool) => tool.name);
  const screenGroups: Record<string, string[]> = {};
  for (const example of EXAMPLES) {
    for (const [screen, uris] of Object.entries(example.screenGroups ?? {})) {
      screenGroups[screen] = [...(screenGroups[screen] ?? []), ...uris];
    }
  }
  return {
    id: CARTRIDGE_ID,
    version,
    displayName: CARTRIDGE_DISPLAY_NAME,
    kind: "byo-mcp",
    kind_version: "1",
    modules: byoModules(toolNames),
    // Specialists are optional (≤12 tools each when present). The examples
    // ship none; see src/coop for the agent-seat policy seam instead.
    specialists: [],
    panels: manifest.resources.map((resource) => ({ uri: resource.uri })),
    screenGroups,
    multiplayer: { supported: false },
  };
}

/** Re-export of the blessed MCP App MIME for legacy call sites. */
export const MCP_APP_MIME = MCP_APP_RESOURCE_MIME_TYPE;
