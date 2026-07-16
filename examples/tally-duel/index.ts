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
import { createDuelPanelServer, DUEL_PANEL_RESOURCE_URI } from "./panel/server.ts";
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
      mintRun: (state) => deps.mintRun(state) as GameState,
    }),
  ],
  screenGroups: {
    duel: [DUEL_PANEL_RESOURCE_URI],
    game_over: [DUEL_PANEL_RESOURCE_URI],
  },
};

export const tallyDuelCoopDomains: CoopDomainRegistration[] = [
  { domain: "tally-duel", factory: (deps) => duelPolicy(deps) },
];
