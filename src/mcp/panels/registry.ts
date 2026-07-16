/**
 * Panel-server aggregator — one MCP App bundling every panel this app ships.
 *
 * The registry is the ONLY place that:
 *   - instantiates panel servers (injecting the shared `dispatch` once),
 *   - routes tools/resources by name/URI into the owning panel,
 *   - enforces uniqueness (duplicate URIs/tool names are authoring bugs).
 *
 * Panels never import the MCP wire or touch another panel's state — the
 * registry glues them (PANEL-AUTHORING.md §2). To add a panel: write its
 * factory next to duel/, instantiate it below, push it into `entries`.
 */

import { cloneState, type Action, type EngineEvent, type GameState } from "../../game/state.ts";
import type {
  McpAppResource,
  McpAppResourceContent,
  PanelServer,
  PanelToolDefinition,
} from "../../../vendor/sorti-contract/index.ts";

import { createDuelPanelServer } from "./duel/server.ts";

/** Shared deps: the host owns the run store and lifecycle; we read from it. */
export interface PanelRegistryDeps {
  /** Look up a run by id. Used by the reducer-backed dispatch helper. */
  getRun(runId: string): GameState | null;
  /** Persist a freshly-reduced run. */
  setRun(runId: string, state: GameState): void;
  /**
   * Action-log-backed reducer step. REQUIRED so every mutation is captured
   * in the action log — that is what makes runs replayable.
   */
  appendAction(runId: string, action: Action): { state: GameState; events: EngineEvent[] };
  /** Most-recent / "active" run, used when a panel reads without context. */
  getActiveState(): GameState | null;
  /** Optional hook fired after every reducer-mutating action (host refresh). */
  onAfterAction?(args: { before: GameState; after: GameState; action: Action }): void;
}

export interface PanelEntry {
  uri: string;
  name: string;
  server: PanelServer;
}

export interface PanelRegistry {
  readonly panels: readonly PanelEntry[];
  readonly tools: readonly PanelToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): ReturnType<PanelServer["callTool"]>;
  readResource(uri: string): ReturnType<PanelServer["readResource"]>;
  listResources(): McpAppResource[];
  getResourceContent(uri: string): McpAppResourceContent | null;
}

export function createPanelRegistry(deps: PanelRegistryDeps): PanelRegistry {
  /** Apply one reducer Action to the named run, persist, and notify. */
  const dispatch = async (runId: string, action: Action): Promise<{ ok: true; state: GameState }> => {
    const before = deps.getRun(runId);
    if (!before) throw new Error(`unknown run: ${runId}`);
    const result = deps.appendAction(runId, action);
    deps.setRun(runId, result.state);
    deps.onAfterAction?.({ before, after: result.state, action });
    return { ok: true, state: cloneState(result.state) };
  };

  // ── panels ────────────────────────────────────────────────────────────
  const duel = createDuelPanelServer({
    getState: () => deps.getActiveState(),
    dispatch,
  });

  const entries: PanelEntry[] = [
    { uri: duel.resource.uri, name: duel.resource.name, server: duel },
  ];

  // ── flat assembly + uniqueness guards ─────────────────────────────────
  const uriSet = new Set<string>();
  for (const entry of entries) {
    if (uriSet.has(entry.uri)) throw new Error(`duplicate panel URI: ${entry.uri}`);
    uriSet.add(entry.uri);
  }

  const tools: PanelToolDefinition[] = [];
  const toolOwner = new Map<string, PanelEntry>();
  for (const entry of entries) {
    for (const tool of entry.server.tools) {
      if (toolOwner.has(tool.name)) throw new Error(`duplicate panel tool: ${tool.name}`);
      tools.push(tool);
      toolOwner.set(tool.name, entry);
    }
  }

  const entryByUri = new Map(entries.map((entry) => [entry.uri, entry]));

  return {
    panels: entries,
    tools,
    async callTool(name, args) {
      const owner = toolOwner.get(name);
      if (!owner) throw new Error(`unknown panel tool: ${name}`);
      return owner.server.callTool(name, args);
    },
    async readResource(uri) {
      const owner = entryByUri.get(uri);
      if (!owner) throw new Error(`unknown panel resource: ${uri}`);
      return owner.server.readResource(uri);
    },
    listResources() {
      return entries.map((entry) => entry.server.resource);
    },
    getResourceContent(uri) {
      return entryByUri.get(uri)?.server.resourceContent ?? null;
    },
  };
}
