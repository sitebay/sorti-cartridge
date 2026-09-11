/**
 * Duel board panel — Tally Duel's PanelServer.
 * Resource: ui://duel/board
 * Slot: main
 * Tools: duel.read_state (pure read), duel.tap / duel.boost (reducer
 * actions), duel.new_run (mint), duel.legal_actions (derivation helper)
 *
 * The shape mirrors PANEL-AUTHORING.md §2/§10: a factory taking injected
 * deps (never globals — the worker rebuilds this server on every request),
 * a pure ViewModel projector exposed as `<panel>.read_state`, and action
 * tools that only ever mutate through the injected `dispatch`.
 */

import {
  MCP_APP_RESOURCE_MIME_TYPE,
  SORTI_META_NAMESPACE,
  createCallToolResult,
  type McpAppResource,
  type McpAppResourceContent,
  type PanelServer,
  type PanelToolDefinition,
} from "../../../vendor/sorti-contract/index.ts";

import { createRun, type Action, type GameState, type PlayerState } from "../state.ts";
import { legalActions } from "../reducer.ts";
import { TEMPLATE_HTML } from "./template.gen.ts";

export const DUEL_PANEL_RESOURCE_URI = "ui://duel/board";

export type DuelViewModel =
  | { kind: "duel"; active: false; reason: string }
  | {
      kind: "duel";
      active: true;
      runId: string;
      targetScore: number;
      players: { id: string; name: string; score: number; boostsLeft: number }[];
      winner: { id: string; name: string } | null;
    };

/** Pure projector: everything the template needs, already computed (§4). */
export function computeDuelViewModel(state: GameState | null): DuelViewModel {
  if (!state) return { kind: "duel", active: false, reason: "no run" };
  const winner: PlayerState | null = state.winnerId
    ? state.players.find((player) => player.id === state.winnerId) ?? null
    : null;
  return {
    kind: "duel",
    active: true,
    runId: state.runId,
    targetScore: state.targetScore,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      boostsLeft: player.boostsLeft,
    })),
    winner: winner ? { id: winner.id, name: winner.name } : null,
  };
}

export interface DuelPanelDeps {
  /** Current authoritative state; null before the first duel.new_run. */
  getState: () => GameState | null;
  /** THE one mutation path: reducer dispatch owned by the chassis. */
  dispatch: (runId: string, action: Action) => Promise<{ ok: true; state: GameState }>;
  /**
   * Replace the session's active run with a fresh duel — unless `kickoffId`
   * names a press that already minted the live run, in which case that run
   * comes back untouched. See `ExampleRuntimeDeps.mintRun`.
   */
  mintRun: (state: GameState, options?: { kickoffId?: string }) => GameState;
}

export function createDuelPanelServer(deps: DuelPanelDeps): PanelServer {
  const resource: McpAppResource = {
    uri: DUEL_PANEL_RESOURCE_URI,
    name: "Duel Board",
    description: "Tally Duel scoreboard and actions.",
    mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        // Least-privilege CSP: this template inlines everything, so every
        // domain list stays empty. Only widen for what YOUR content loads.
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        permissions: {},
      },
      [SORTI_META_NAMESPACE]: {
        layout: {
          slot: "main",
          role: "primary-canvas",
          title: "Duel",
          icon: "swords",
          resizable: false,
          stackOrder: 10,
        },
        drag: { sources: [], targets: [] },
      },
    },
  };

  const resourceContent: McpAppResourceContent = {
    uri: DUEL_PANEL_RESOURCE_URI,
    mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    text: TEMPLATE_HTML,
    _meta: resource._meta!,
  };

  const readState: PanelToolDefinition = {
    name: "duel.read_state",
    description: "Returns the duel board view-model (pure read, no mutation).",
    inputSchema: { type: "object", properties: {} },
    _meta: { ui: { resourceUri: DUEL_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: () => computeDuelViewModel(deps.getState()),
  };

  const newRun: PanelToolDefinition = {
    name: "duel.new_run",
    description:
      "Start a new Tally Duel run (replaces the session's active run). " +
      "Args: seed?, targetScore?, players? ([{id, name?}], min 2), kickoffId? " +
      "(mint ONE per press: resending the same id resumes the run it started " +
      "instead of discarding it).",
    inputSchema: {
      type: "object",
      properties: {
        seed: { type: "number" },
        targetScore: { type: "number" },
        players: { type: "array" },
        kickoffId: {
          type: "string",
          description:
            "Identity of the PRESS, minted once per user gesture. A repeat of "
            + "the same id resumes; a different id is a new intent and mints.",
        },
      },
    },
    handler: (raw) => {
      const args = (raw ?? {}) as {
        seed?: number;
        targetScore?: number;
        players?: { id: string; name?: string }[];
        runId?: string;
        kickoffId?: string;
      };
      const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed!) : 1;
      const state = deps.mintRun(
        createRun({
          runId: args.runId ?? `duel-run-${seed}`,
          seed,
          ...(args.targetScore !== undefined ? { targetScore: args.targetScore } : {}),
          ...(args.players ? { players: args.players } : {}),
        }),
        args.kickoffId ? { kickoffId: args.kickoffId } : undefined,
      );
      return { ok: true, runId: state.runId, state };
    },
  };

  const legalActionsTool: PanelToolDefinition = {
    name: "duel.legal_actions",
    description: "List the dispatchable duel actions for the active run (optionally one seat).",
    inputSchema: { type: "object", properties: { playerId: { type: "string" } } },
    handler: (raw) => {
      const args = (raw ?? {}) as { playerId?: string };
      const state = deps.getState();
      if (!state) return { actions: [] };
      return { actions: legalActions(state, args.playerId) };
    },
  };

  const requirePlayer = (raw: unknown): { state: GameState; playerId: string } => {
    const args = (raw ?? {}) as { playerId?: string };
    const state = deps.getState();
    if (!state) throw new Error("no active run — call duel.new_run first");
    const playerId = args.playerId ?? state.players[0]?.id;
    if (!playerId) throw new Error("no player available");
    return { state, playerId };
  };

  const tap: PanelToolDefinition = {
    name: "duel.tap",
    description: "Score 1 point for a player.",
    inputSchema: { type: "object", properties: { playerId: { type: "string" } } },
    _meta: { ui: { resourceUri: DUEL_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: async (raw) => {
      const { state, playerId } = requirePlayer(raw);
      const result = await deps.dispatch(state.runId, { kind: "tap", playerId });
      return computeDuelViewModel(result.state);
    },
  };

  const boost: PanelToolDefinition = {
    name: "duel.boost",
    description: "Score 3 points for a player (limited uses per run).",
    inputSchema: { type: "object", properties: { playerId: { type: "string" } } },
    _meta: { ui: { resourceUri: DUEL_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: async (raw) => {
      const { state, playerId } = requirePlayer(raw);
      const result = await deps.dispatch(state.runId, { kind: "boost", playerId });
      return computeDuelViewModel(result.state);
    },
  };

  const tools: PanelToolDefinition[] = [readState, newRun, legalActionsTool, tap, boost];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    resource,
    resourceContent,
    tools,
    async callTool(name, args) {
      const tool = toolsByName.get(name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      return createCallToolResult(await tool.handler(args));
    },
    async readResource(uri) {
      if (uri !== DUEL_PANEL_RESOURCE_URI) throw new Error(`unknown resource: ${uri}`);
      return resourceContent;
    },
  };
}
