/**
 * Duel board panel — Tally Duel's PanelServer.
 * Resource: ui://duel/board
 * Slot: main
 * Tools: duel.read_state (pure read), duel.tap / duel.boost / duel.recharge
 * (reducer actions), duel.new_run (mint), duel.legal_actions (derivation helper),
 * duel.coop_policy_decide (the agent seat's served policy — see below)
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
  type CoopPolicyDeps,
  type PanelServer,
  type PanelToolDefinition,
  type Policy,
  type RoomSnapshot,
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
      players: {
        id: string;
        name: string;
        score: number;
        boostsLeft: number;
        /** Derived by the reducer's legalActions — panels render it, never re-derive it. */
        canRecharge: boolean;
      }[];
      winner: { id: string; name: string } | null;
    };

/** Pure projector: everything the template needs, already computed (§4). */
export function computeDuelViewModel(state: GameState | null): DuelViewModel {
  if (!state) return { kind: "duel", active: false, reason: "no run" };
  const winner: PlayerState | null = state.winnerId
    ? state.players.find((player) => player.id === state.winnerId) ?? null
    : null;
  // ONE owner for availability: ask the reducer what is legal right now.
  const legal = legalActions(state);
  const rechargeable = new Set(
    legal.filter((action) => action.kind === "recharge").map((action) => action.playerId),
  );
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
      canRecharge: rechargeable.has(player.id),
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
  /**
   * This app's agent-seat policy FACTORY, INJECTED rather than imported.
   *
   * `coop-policy.ts` imports {@link DUEL_PANEL_RESOURCE_URI} from this file (it
   * has to: the panel a halo lands on is this app's vocabulary), so importing
   * the policy back into the panel server would close a module cycle. The
   * example's `index.ts` already holds both halves and is the seam that wires
   * them — so it hands the policy down, and neither file imports the other.
   *
   * A FACTORY AND NOT AN INSTANCE, since `guidance` arrived: the plan the
   * person and Sorti's chat brain agreed rides the decide CALL, not the
   * construction, and this policy is stateless — so the honest way to hand it
   * a per-call dep is to build it per call. (A held instance plus a mutable
   * slot would work too, and would be one more piece of state to get wrong on
   * a Worker that rebuilds this server every request anyway.)
   */
  policy: (deps?: CoopPolicyDeps) => Policy<unknown, unknown>;
}

/** The one tool name this app serves its policy on — declared in the manifest. */
export const DUEL_COOP_POLICY_TOOL = "duel.coop_policy_decide";

/** A pass. Three ways to reach it below, and every one of them is an `ok` answer. */
const HOLD = { ok: true as const, data: { draft: null, attention: null } };

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

  const recharge: PanelToolDefinition = {
    name: "duel.recharge",
    description:
      "Spend 2 score to restore 1 boost for a player (only while the seat has 2+ score " +
      "and is below its initial boost allowance).",
    inputSchema: { type: "object", properties: { playerId: { type: "string" } } },
    _meta: { ui: { resourceUri: DUEL_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: async (raw) => {
      const { state, playerId } = requirePlayer(raw);
      const result = await deps.dispatch(state.runId, { kind: "recharge", playerId });
      return computeDuelViewModel(result.state);
    },
  };

  /**
   * ── THE SERVED POLICY ────────────────────────────────────────────────────
   *
   * The agent's seat asks THIS APP what to do, instead of the platform holding
   * a copy of your strategy.
   *
   * Why it is a tool at all: a coop policy could previously reach Sorti only as
   * a module path in the operator's own environment (`SORTI_COOP_DOMAIN_MODULES`),
   * a seam that is env-only on purpose — dynamic-importing a module named by
   * remote data is code execution — and therefore one no third-party maker can
   * ever be given. Declared as `coop.policy.decideTool` in the capabilities
   * document, this tool is the door that IS open to you.
   *
   * Why ONE tool and not three: of the policy contract's three members only
   * `decide` may await. `shouldAct` returns a boolean and gates every tick;
   * `attention` is contractually pure and synchronous. So the agent answers
   * those two locally and asks you once — which is why the reply carries the
   * attention with it rather than making the halo a second round trip.
   *
   * It is a THIN WRAPPER. The strategy is `coop-policy.ts` and is not written
   * twice; this hands it the snapshot and hands back what it said.
   */
  const coopPolicyDecide: PanelToolDefinition = {
    name: DUEL_COOP_POLICY_TOOL,
    description:
      "The agent seat's decision lane: given the room snapshot and the seat the agent holds, " +
      "return { ok, data: { draft, attention } } — one op to propose (or null to pass) plus " +
      "where the seat is looking. Read-only: it decides, it never dispatches.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string" },
        seatId: { type: "string", description: "The seat the agent holds — it decides for that seat only." },
        snapshot: { type: "object", description: "The room snapshot the agent read this tick." },
        guidance: {
          type: "string",
          description:
            "One sentence the person and Sorti's chat brain agreed for this seat (\"go aggressive this fight\"), "
            + "absent when they have agreed nothing. Honour what you RECOGNISE, ignore what you do not — it is "
            + "advice, and the ops you return are still yours to make legal.",
        },
      },
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as { seatId?: unknown; snapshot?: unknown; guidance?: unknown };
      const seatId = typeof args.seatId === "string" ? args.seatId.trim() : "";
      const snapshot =
        args.snapshot && typeof args.snapshot === "object" && !Array.isArray(args.snapshot)
          ? (args.snapshot as RoomSnapshot<unknown>)
          : null;
      // A malformed ask HOLDS. A seat that cannot decide should wait a tick;
      // throwing would turn one bad call into an erroring seat on backoff.
      if (!seatId || !snapshot) return HOLD;
      // THE PLAN, as the request carried it. Anything that is not a string is
      // not a plan — a hostile or confused caller costs a directive, never a
      // tick.
      const guidance = typeof args.guidance === "string" ? args.guidance.trim() : "";
      const policy = deps.policy(guidance ? { guidance } : undefined);
      if (!policy.shouldAct(snapshot, seatId)) return HOLD;
      const draft = await policy.decide(snapshot, seatId);
      if (!draft) return HOLD;
      return {
        ok: true as const,
        data: { draft, attention: policy.attention?.(draft, snapshot, seatId) ?? null },
      };
    },
  };

  const tools: PanelToolDefinition[] = [
    readState,
    newRun,
    legalActionsTool,
    tap,
    boost,
    recharge,
    coopPolicyDecide,
  ];
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
