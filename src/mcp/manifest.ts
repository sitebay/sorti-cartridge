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
import { alwaysLoadToolNames } from "./alwaysLoad.ts";
import { EXAMPLES } from "../../examples/index.ts";
import {
  MCP_APP_RESOURCE_MIME_TYPE,
  type SortiAppManifest,
} from "../../vendor/sorti-contract/index.ts";

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
  /**
   * What the platform's bar may CALL — see `CartridgeExample.probeTools`.
   * Resolved against the tools this cartridge actually serves, so the document
   * can never name a probe tool the server would refuse.
   */
  conformance?: { probeTools: string[] };
  /**
   * The app's own `SortiAppManifest`, EMBEDDED rather than left to a second
   * fetch. A host reads this key first and only falls back to
   * `resources/read sorti-app://manifest`, so a server that answers here
   * answers once, at activation, with no extra round trip.
   *
   * It exists because of `quickActions`: the launcher buttons beside your
   * app's tile are YOURS, and until a host could read `agentPrompt`,
   * `resumePrompt` and `guardLiveRun` off the wire, the only place they could
   * be said was the host's own hand-written catalog (sts2 9d02a1fe).
   */
  manifest?: SortiAppManifest;
  /**
   * Agent-seat coop metadata. Present iff a domain is declared — a host that
   * finds no `domain` ignores the whole block (`parseAuthMetadata`).
   *
   * NO `seatId` HERE, DELIBERATELY: the seat is whatever the roster assigns at
   * join time, and a remembered seat acts for the wrong player.
   */
  coop?: {
    domain: string;
    /** See `src/mcp/alwaysLoad.ts` — this is the published half of ONE list. */
    alwaysLoadTools: string[];
    kickoffPrompt?: string;
    /**
     * The app's OWN policy, served as a tool (`CartridgeExample.coopPolicyTool`).
     * Present only when the owning example declares a tool this cartridge
     * actually serves — a document promising a tool that is not on the wire is
     * the exact defect `probeToolNames` exists to prevent, and the same
     * discipline applies here.
     */
    policy?: { version: "1"; decideTool: string };
  };
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

/**
 * The published half of the always-load spine — see `src/mcp/alwaysLoad.ts`.
 * Resolved against the tools this cartridge actually serves, so the document
 * can never promise a tool that is not on the wire.
 */
export const ALWAYS_LOAD_TOOLS: readonly string[] = alwaysLoadToolNames(
  buildPanelManifest().contracts.tools.map((tool) => tool.name),
);

/**
 * The probe tools the examples declare, filtered to what is SERVED.
 *
 * Same discipline as `alwaysLoadToolNames`: a document that promises a tool
 * this cartridge does not answer is a document that fails the bar it was
 * written to pass.
 */
export function probeToolNames(served: readonly string[]): string[] {
  const declared = EXAMPLES.flatMap((example) => example.probeTools ?? []);
  return declared.filter((name, index) => served.includes(name) && declared.indexOf(name) === index);
}

/**
 * `/.well-known/mcp/server-card.json` — the STATIC surface catalogs read
 * before they ever open a session, and the fifth route the BYO conformance
 * suite asks for (`test-server-card.mjs`). Derived from the same panel
 * manifest as `tools/list`, which is the only way a card can be free of
 * omissions AND phantoms by construction rather than by discipline.
 */
export interface ServerCard {
  name: string;
  version: string;
  tools: { name: string; description: string; inputSchema: unknown }[];
  resources: { uri: string; name: string; mimeType: string }[];
}

export function buildServerCard(version = SERVER_VERSION): ServerCard {
  const manifest = buildPanelManifest();
  return {
    name: CARTRIDGE_DISPLAY_NAME,
    version,
    tools: manifest.contracts.tools,
    resources: manifest.resources,
  };
}

export function buildByoCapabilities(version = SERVER_VERSION): ByoCapabilities {
  const manifest = buildPanelManifest();
  const toolNames = manifest.contracts.tools.map((tool) => tool.name);
  const probeTools = probeToolNames(toolNames);
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
    ...(probeTools.length > 0 ? { conformance: { probeTools } } : {}),
    manifest: {
      id: CARTRIDGE_ID,
      name: CARTRIDGE_DISPLAY_NAME,
      description: EXAMPLES.map((example) => example.displayName).join(" · "),
      presentation: "workspace",
      // Auto-mount exactly what this cartridge serves. A host given no list
      // fetches `resources/list` and mounts every UI resource, which is the
      // same answer — said once instead of twice.
      panels: manifest.resources.map((resource) => resource.uri),
      quickActions: EXAMPLES.flatMap((example) => example.quickActions ?? []),
    },
    // One cartridge, one coop domain on the wire: the FIRST registered example
    // owns it, because `coop.domain` is a single string and a host that reads
    // two would have to guess. Delete the examples you do not ship and yours
    // is the one that remains (AGENTS.md step 5).
    ...(EXAMPLES[0]
      ? {
          coop: {
            domain: EXAMPLES[0].id,
            alwaysLoadTools: [...ALWAYS_LOAD_TOOLS],
            // Resolved against what is SERVED, like `probeToolNames` above: a
            // declaration naming a tool this cartridge does not answer would
            // send the agent's seat to a door that is not there, and it would
            // do so on every tick.
            ...(EXAMPLES[0].coopPolicyTool && toolNames.includes(EXAMPLES[0].coopPolicyTool)
              ? { policy: { version: "1" as const, decideTool: EXAMPLES[0].coopPolicyTool } }
              : {}),
          },
        }
      : {}),
  };
}

/** Re-export of the blessed MCP App MIME for legacy call sites. */
export const MCP_APP_MIME = MCP_APP_RESOURCE_MIME_TYPE;
