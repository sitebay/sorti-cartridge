/**
 * Sticky Board — the productivity/spatial-flavor example app, registered
 * into the chassis via examples/index.ts. Proves the same chassis carries a
 * document-like, canvas-LOOKING surface: it is a guest panel, not the host
 * canvas — drags buffer locally and commit ONE move_note like any other
 * reducer action.
 */

import type {
  CartridgeExample,
  CoopDomainRegistration,
  ExampleRuntimeDeps,
} from "../../src/mcp/example-contract.ts";
import type { BoardAction, BoardState } from "./state.ts";
import { reduce } from "./reducer.ts";
import { createBoardPanelServer, BOARD_PANEL_RESOURCE_URI } from "./panel/server.ts";
import { boardTidyPolicy } from "./coop-policy.ts";

export const boardExample: CartridgeExample = {
  id: "board",
  displayName: "Sticky Board",
  instructions:
    "A sticky-notes board; one board per run (a document = a run). Start with " +
    "board.new_board, read board.read_state before acting. Actions: board.add_note (text, " +
    "optional x/y/color), board.move_note (noteId, x, y — one call per completed drag), " +
    "board.edit_note, board.remove_note, board.set_color.",
  reduce: (state, action) => reduce(state as BoardState, action as BoardAction),
  createPanels: (deps: ExampleRuntimeDeps) => [
    createBoardPanelServer({
      getState: () => deps.getActiveState() as BoardState | null,
      dispatch: (runId, action) =>
        deps.dispatch(runId, action) as Promise<{ ok: true; state: BoardState }>,
      mintRun: (state) => deps.mintRun(state) as BoardState,
    }),
  ],
  screenGroups: {
    board: [BOARD_PANEL_RESOURCE_URI],
  },
};

export const boardCoopDomains: CoopDomainRegistration[] = [
  { domain: "board", factory: (deps) => boardTidyPolicy(deps) },
];
