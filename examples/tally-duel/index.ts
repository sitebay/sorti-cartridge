/**
 * Tally Duel — the game-flavor example app, registered into the chassis via
 * examples/index.ts. This file is the whole registration seam: the reducer,
 * the panel factory, the screen groups, and the coop domain.
 */

import type {
  CartridgeExample,
  CoopDomainRegistration,
  ExampleRuntimeDeps,
} from "../../src/mcp/example-contract.ts";
import type { Action, GameState } from "./state.ts";
import { reduce } from "./reducer.ts";
import { createDuelPanelServer, DUEL_COOP_POLICY_TOOL, DUEL_PANEL_RESOURCE_URI } from "./panel/server.ts";
import { duelPolicy } from "./coop-policy.ts";

export const tallyDuelExample: CartridgeExample = {
  id: "tally-duel",
  displayName: "Tally Duel",
  instructions:
    "A two-seat race to the target score. Start with duel.new_run (seed, targetScore, " +
    "players optional). Read duel.read_state before acting. Actions: duel.tap scores 1; " +
    "duel.boost scores 3 and spends one of the seat's limited boosts. The run ends when a " +
    "seat reaches targetScore.",
  reduce: (state, action) => reduce(state as GameState, action as Action),
  createPanels: (deps: ExampleRuntimeDeps) => [
    createDuelPanelServer({
      getState: () => deps.getActiveState() as GameState | null,
      dispatch: (runId, action) =>
        deps.dispatch(runId, action) as Promise<{ ok: true; state: GameState }>,
      mintRun: (state, options) => deps.mintRun(state, options) as GameState,
      // The SAME policy `tallyDuelCoopDomains` registers, handed down here so
      // the panel server can serve it as a tool without importing it (the
      // policy imports the panel's resource uri; this seam is what keeps that
      // from being a cycle).
      policy: duelPolicy(),
    }),
  ],
  screenGroups: {
    duel: [DUEL_PANEL_RESOURCE_URI],
    game_over: [DUEL_PANEL_RESOURCE_URI],
  },
  // The ACTION verbs a seat must be able to FIND on turn one. `read_state`
  // arrives by pattern (src/mcp/alwaysLoad.ts) and is deliberately not listed.
  alwaysLoadTools: ["duel.new_run", "duel.legal_actions", "duel.tap", "duel.boost"],
  // What the platform's bar may CALL on the deployed app: a pure read, no
  // arguments, no side effect. NOT `duel.new_run` — the bar would mint a run
  // in production every time someone re-proved the listing.
  probeTools: ["duel.read_state"],
  // YOUR strategy, served rather than shipped. Before this, a coop app's policy
  // reached the agent only through an operator's `SORTI_COOP_DOMAIN_MODULES` —
  // a module path no third party can be allowed to supply — so a deployed
  // cartridge had its seat played by the platform's generic policy no matter
  // what `coop-policy.ts` said. Declaring the tool is what hands the seat back.
  coopPolicyTool: DUEL_COOP_POLICY_TOOL,
  quickActions: [
    {
      id: "new-duel-with-sorti",
      label: "🎲 New duel with Sorti",
      tool: "duel.new_run",
      title:
        "Start a new Tally Duel run with Sorti in the second seat. If a run is already in "
        + "progress, drops you into it instead of restarting.",
      successMessage: "New duel started — Sorti is taking a seat.",
      // ⛔ DESTRUCTIVE: this tool replaces the live run. A host that renders
      // the button MUST skip the call when a run is open and open the panel
      // instead — "if there's a game, there shouldn't be an embark".
      guardLiveRun: true,
      // Without an agentPrompt the tool call is INVISIBLE to the agent, which
      // then reports "no run loaded yet" at a table that just started one.
      agentPrompt:
        "New Tally Duel run — you have the second seat. Read duel.read_state, then play your "
        + "seat: duel.tap scores 1, duel.boost scores 3 and spends a boost.",
      // Sent INSTEAD when guardLiveRun found a live run: join what is already
      // running. Two runs = the seats in different games.
      resumePrompt:
        "We already have a Tally Duel run in progress. Do NOT start a new one — read "
        + "duel.read_state and continue from wherever we are, playing your own seat.",
    },
  ],
};

export const tallyDuelCoopDomains: CoopDomainRegistration[] = [
  { domain: "tally-duel", factory: (deps) => duelPolicy(deps) },
];
