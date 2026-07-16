import { describe, expect, test } from "bun:test";
import { createBoard, type BoardAction, type BoardState } from "../examples/board/state.ts";
import { reduce } from "../examples/board/reducer.ts";
import {
  BOARD_PANEL_RESOURCE_URI,
  computeBoardViewModel,
  createBoardPanelServer,
} from "../examples/board/panel/server.ts";
import {
  MCP_APP_RESOURCE_MIME_TYPE,
  SORTI_META_NAMESPACE,
} from "../vendor/sorti-contract/index.ts";

function harness(initial: BoardState | null = null) {
  let state = initial;
  const dispatched: BoardAction[] = [];
  const server = createBoardPanelServer({
    getState: () => state,
    dispatch: async (runId: string, action: BoardAction) => {
      if (!state || state.runId !== runId) throw new Error(`unknown run: ${runId}`);
      dispatched.push(action);
      state = reduce(state, action).state;
      return { ok: true, state };
    },
    mintRun: (next: BoardState) => {
      state = next;
      return structuredClone(next);
    },
  });
  return { server, dispatched, getState: () => state };
}

describe("board panel contract", () => {
  test("read_state is pure and returns the inactive VM without a board", async () => {
    const { server, dispatched } = harness(null);
    const result = await server.callTool("board.read_state", {});
    expect(result.structuredContent).toEqual({ kind: "board", active: false, reason: "no board" });
    expect(dispatched).toHaveLength(0);
  });

  test("board.new_board mints through the injected mintRun", async () => {
    const { server, getState } = harness(null);
    const result = await server.callTool("board.new_board", { seed: 5 });
    const value = result.structuredContent as { ok: boolean; runId: string };
    expect(value).toMatchObject({ ok: true, runId: "board-5" });
    expect(getState()!.notes).toEqual([]);
  });

  test("add → move → edit → recolor mutate through dispatch and echo the fresh VM", async () => {
    const { server, dispatched, getState } = harness(createBoard({ runId: "b1", seed: 1 }));

    await server.callTool("board.add_note", { text: "hello", x: 40, y: 40 });
    expect(getState()!.notes[0]!).toMatchObject({ id: "n1", text: "hello", x: 40, y: 40 });

    const moved = await server.callTool("board.move_note", { noteId: "n1", x: 220, y: 140 });
    const movedVm = moved.structuredContent as { notes: { x: number; y: number }[] };
    expect(movedVm.notes[0]!).toMatchObject({ x: 220, y: 140 });

    await server.callTool("board.edit_note", { noteId: "n1", text: "hello again" });
    await server.callTool("board.set_color", { noteId: "n1", color: "green" });
    expect(getState()!.notes[0]!).toMatchObject({ text: "hello again", color: "green" });

    expect(dispatched.map((action) => action.kind)).toEqual([
      "add_note",
      "move_note",
      "edit_note",
      "set_color",
    ]);
  });

  test("remove_note empties the board", async () => {
    let state = createBoard({ runId: "b1", seed: 1 });
    state = reduce(state, { kind: "add_note", text: "bye" }).state;
    const { server, getState } = harness(state);
    await server.callTool("board.remove_note", { noteId: "n1" });
    expect(getState()!.notes).toEqual([]);
  });

  test("action without an active board throws", async () => {
    const { server } = harness(null);
    await expect(server.callTool("board.add_note", { text: "x" })).rejects.toThrow(/no active board/);
  });

  test("view model is self-contained JSON", () => {
    let state = createBoard({ runId: "b1", seed: 2 });
    state = reduce(state, { kind: "add_note", text: "a", x: 10, y: 20, color: "pink" }).state;
    const vm = computeBoardViewModel(state);
    expect(vm).toEqual({
      kind: "board",
      active: true,
      runId: "b1",
      width: 960,
      height: 600,
      notes: [{ id: "n1", text: "a", x: 10, y: 20, color: "pink" }],
      noteCount: 1,
    });
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
  });

  test("readResource serves the HTML template with the MCP App mime + layout meta", async () => {
    const { server } = harness(null);
    const content = await server.readResource(BOARD_PANEL_RESOURCE_URI);
    expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME_TYPE);
    expect(content.text).toContain("<!doctype html>");
    expect(content.text).toContain("window.SortiPanel");
    expect(content.text).toContain("board.move_note"); // drag commits one move
    const meta = content._meta?.[SORTI_META_NAMESPACE] as { layout?: { slot?: string } };
    expect(meta.layout?.slot).toBe("main");
  });

  test("tool names follow the <panel>.* convention", () => {
    const { server } = harness(null);
    expect(server.tools.map((tool) => tool.name)).toEqual([
      "board.read_state",
      "board.new_board",
      "board.add_note",
      "board.move_note",
      "board.edit_note",
      "board.remove_note",
      "board.set_color",
    ]);
  });
});
