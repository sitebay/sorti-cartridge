/**
 * Sticky Board panel — the productivity/spatial example's PanelServer.
 * Resource: ui://board/notes
 * Slot: main
 * Tools: board.read_state (pure), board.new_board (mint), board.add_note,
 *        board.move_note, board.edit_note, board.remove_note, board.set_color
 *
 * Spatial ≠ special: every drag in the template buffers locally and commits
 * exactly ONE board.move_note through the same dispatch path as everything
 * else. No side channel, no host-canvas API — this is a guest panel.
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

import {
  createBoard,
  type BoardAction,
  type BoardState,
  type NoteColor,
} from "../state.ts";
import { TEMPLATE_HTML } from "./template.gen.ts";

export const BOARD_PANEL_RESOURCE_URI = "ui://board/notes";

export type BoardViewModel =
  | { kind: "board"; active: false; reason: string }
  | {
      kind: "board";
      active: true;
      runId: string;
      width: number;
      height: number;
      notes: { id: string; text: string; x: number; y: number; color: NoteColor }[];
      noteCount: number;
    };

/** Pure projector: everything the template needs, already computed (§4). */
export function computeBoardViewModel(state: BoardState | null): BoardViewModel {
  if (!state) return { kind: "board", active: false, reason: "no board" };
  return {
    kind: "board",
    active: true,
    runId: state.runId,
    width: state.width,
    height: state.height,
    notes: state.notes.map((note) => ({
      id: note.id,
      text: note.text,
      x: note.x,
      y: note.y,
      color: note.color,
    })),
    noteCount: state.notes.length,
  };
}

export interface BoardPanelDeps {
  getState: () => BoardState | null;
  dispatch: (runId: string, action: BoardAction) => Promise<{ ok: true; state: BoardState }>;
  /**
   * Replace the session's active run with a fresh board — unless `kickoffId`
   * names a press that already minted the live board, in which case that board
   * comes back untouched. See `ExampleRuntimeDeps.mintRun`.
   */
  mintRun: (state: BoardState, options?: { kickoffId?: string }) => BoardState;
}

export function createBoardPanelServer(deps: BoardPanelDeps): PanelServer {
  const resource: McpAppResource = {
    uri: BOARD_PANEL_RESOURCE_URI,
    name: "Sticky Board",
    description: "A shared sticky-notes board (one board per run).",
    mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        permissions: {},
      },
      [SORTI_META_NAMESPACE]: {
        layout: {
          slot: "main",
          role: "primary-canvas",
          title: "Board",
          icon: "sticky-note",
          resizable: true,
          stackOrder: 20,
        },
        drag: { sources: [], targets: [] },
      },
    },
  };

  const resourceContent: McpAppResourceContent = {
    uri: BOARD_PANEL_RESOURCE_URI,
    mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    text: TEMPLATE_HTML,
    _meta: resource._meta!,
  };

  const requireBoard = (): BoardState => {
    const state = deps.getState();
    if (!state) throw new Error("no active board — call board.new_board first");
    return state;
  };

  /** Shared shape for the reducer-backed action tools. */
  const actionTool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    toAction: (args: Record<string, unknown>) => BoardAction,
  ): PanelToolDefinition => ({
    name,
    description,
    inputSchema: { type: "object", properties, required },
    _meta: { ui: { resourceUri: BOARD_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: async (raw) => {
      const state = requireBoard();
      const result = await deps.dispatch(state.runId, toAction((raw ?? {}) as Record<string, unknown>));
      return computeBoardViewModel(result.state);
    },
  });

  const readState: PanelToolDefinition = {
    name: "board.read_state",
    description: "Returns the sticky-board view-model (pure read, no mutation).",
    inputSchema: { type: "object", properties: {} },
    _meta: { ui: { resourceUri: BOARD_PANEL_RESOURCE_URI, visibility: ["model", "panel"] } },
    handler: () => computeBoardViewModel(deps.getState()),
  };

  const newBoard: PanelToolDefinition = {
    name: "board.new_board",
    description:
      "Start a fresh board (replaces the session's active run). Args: seed?, "
      + "kickoffId? (mint ONE per press: resending the same id resumes the "
      + "board it started instead of discarding it).",
    inputSchema: {
      type: "object",
      properties: {
        seed: { type: "number" },
        kickoffId: {
          type: "string",
          description:
            "Identity of the PRESS, minted once per user gesture. A repeat of "
            + "the same id resumes; a different id is a new intent and mints.",
        },
      },
    },
    handler: (raw) => {
      const args = (raw ?? {}) as { seed?: number; runId?: string; kickoffId?: string };
      const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed!) : 1;
      const state = deps.mintRun(
        createBoard({ runId: args.runId ?? `board-${seed}`, seed }),
        args.kickoffId ? { kickoffId: args.kickoffId } : undefined,
      );
      return { ok: true, runId: state.runId, state };
    },
  };

  const tools: PanelToolDefinition[] = [
    readState,
    newBoard,
    actionTool(
      "board.add_note",
      "Add a sticky note. Args: text (required), x?, y?, color? (yellow|pink|blue|green).",
      {
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        color: { type: "string", enum: ["yellow", "pink", "blue", "green"] },
      },
      ["text"],
      (args) => ({
        kind: "add_note",
        text: String(args.text ?? ""),
        ...(args.x !== undefined ? { x: Number(args.x) } : {}),
        ...(args.y !== undefined ? { y: Number(args.y) } : {}),
        ...(args.color !== undefined ? { color: args.color as NoteColor } : {}),
      }),
    ),
    actionTool(
      "board.move_note",
      "Move a note to (x, y). One call per completed drag.",
      { noteId: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
      ["noteId", "x", "y"],
      (args) => ({
        kind: "move_note",
        noteId: String(args.noteId ?? ""),
        x: Number(args.x),
        y: Number(args.y),
      }),
    ),
    actionTool(
      "board.edit_note",
      "Replace a note's text.",
      { noteId: { type: "string" }, text: { type: "string" } },
      ["noteId", "text"],
      (args) => ({ kind: "edit_note", noteId: String(args.noteId ?? ""), text: String(args.text ?? "") }),
    ),
    actionTool(
      "board.remove_note",
      "Remove a note.",
      { noteId: { type: "string" } },
      ["noteId"],
      (args) => ({ kind: "remove_note", noteId: String(args.noteId ?? "") }),
    ),
    actionTool(
      "board.set_color",
      "Recolor a note (yellow|pink|blue|green).",
      { noteId: { type: "string" }, color: { type: "string", enum: ["yellow", "pink", "blue", "green"] } },
      ["noteId", "color"],
      (args) => ({
        kind: "set_color",
        noteId: String(args.noteId ?? ""),
        color: args.color as NoteColor,
      }),
    ),
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
      if (uri !== BOARD_PANEL_RESOURCE_URI) throw new Error(`unknown resource: ${uri}`);
      return resourceContent;
    },
  };
}
