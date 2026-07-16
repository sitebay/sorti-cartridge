import { describe, expect, test } from "bun:test";
import { createMcpServer, type JsonRpcRequest } from "../src/mcp/server.ts";
import { createRun, type Action } from "../examples/tally-duel/state.ts";
import { reduce } from "../examples/tally-duel/reducer.ts";

type RpcReply = { jsonrpc: "2.0"; id?: unknown; result?: any; error?: { code: number; message: string } };

function rpc(method: string, params?: Record<string, unknown>, id: number = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

describe("MCP server", () => {
  test("initialize advertises the contract surface", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("initialize"))) as RpcReply;
    expect(reply.result.protocolVersion).toBe("2024-11-05");
    expect(reply.result.serverInfo.name).toBe("sorti-cartridge");
    expect(reply.result.capabilities.resources.listChanged).toBe(true);
    expect(reply.result.instructions).toContain("duel.read_state");
    expect(reply.result.instructions).toContain("board.read_state");
  });

  test("tools/list carries every example's panel tools", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("tools/list"))) as RpcReply;
    const names = reply.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual([
      "duel.read_state",
      "duel.new_run",
      "duel.legal_actions",
      "duel.tap",
      "duel.boost",
      "board.read_state",
      "board.new_board",
      "board.add_note",
      "board.move_note",
      "board.edit_note",
      "board.remove_note",
      "board.set_color",
    ]);
  });

  test("duel.new_run → duel.tap → duel.read_state round-trips through one session", async () => {
    const server = createMcpServer();

    const minted = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.new_run", arguments: { seed: 3, targetScore: 4 } }),
    )) as RpcReply;
    expect(minted.result.isError).toBeUndefined();
    const runId = minted.result.structuredContent.runId as string;
    expect(server.runs.get(runId)?.appId).toBe("tally-duel");

    const tapped = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.tap", arguments: { playerId: "p1" } }),
    )) as RpcReply;
    expect(tapped.result.isError).toBeUndefined();

    const read = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.read_state", arguments: {} }),
    )) as RpcReply;
    const vm = read.result.structuredContent;
    expect(vm.players[0].score).toBe(1);
    expect(vm.targetScore).toBe(4);

    // Replay doctrine: the recorded log reproduces the live state.
    const record = server.runs.get(runId)!;
    let replayed = createRun({ runId, seed: 3, targetScore: 4 });
    for (const action of record.log as Action[]) replayed = reduce(replayed, action).state;
    expect(replayed).toEqual(record.state as ReturnType<typeof createRun>);
  });

  test("board flow: new_board → add_note → move_note → read_state", async () => {
    const server = createMcpServer();
    await server.handleJsonRpc(rpc("tools/call", { name: "board.new_board", arguments: { seed: 2 } }));
    await server.handleJsonRpc(
      rpc("tools/call", { name: "board.add_note", arguments: { text: "ship it", x: 50, y: 60 } }),
    );
    await server.handleJsonRpc(
      rpc("tools/call", { name: "board.move_note", arguments: { noteId: "n1", x: 200, y: 220 } }),
    );
    const read = (await server.handleJsonRpc(
      rpc("tools/call", { name: "board.read_state", arguments: {} }),
    )) as RpcReply;
    expect(read.result.structuredContent.notes).toEqual([
      { id: "n1", text: "ship it", x: 200, y: 220, color: "yellow" },
    ]);
  });

  test("apps are isolated: a duel run leaves the board inactive, and vice versa", async () => {
    const server = createMcpServer();
    await server.handleJsonRpc(rpc("tools/call", { name: "duel.new_run", arguments: {} }));

    const boardRead = (await server.handleJsonRpc(
      rpc("tools/call", { name: "board.read_state", arguments: {} }),
    )) as RpcReply;
    expect(boardRead.result.structuredContent.active).toBe(false);

    // Board actions cannot touch the duel's run.
    const stray = (await server.handleJsonRpc(
      rpc("tools/call", { name: "board.add_note", arguments: { text: "nope" } }),
    )) as RpcReply;
    expect(stray.result.isError).toBe(true);

    // Minting a board replaces the session's active run (single-run model).
    await server.handleJsonRpc(rpc("tools/call", { name: "board.new_board", arguments: {} }));
    const duelRead = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.read_state", arguments: {} }),
    )) as RpcReply;
    expect(duelRead.result.structuredContent.active).toBe(false);
  });

  test("illegal actions surface as isError tool results, not thrown 500s", async () => {
    const server = createMcpServer();
    await server.handleJsonRpc(rpc("tools/call", { name: "duel.new_run", arguments: {} }));
    const reply = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.tap", arguments: { playerId: "ghost" } }),
    )) as RpcReply;
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("unknown player");
  });

  test("unknown tool is a tool-level error, not a missing method", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("tools/call", { name: "nope.nothing" }))) as RpcReply;
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain('unknown tool "nope.nothing"');
  });

  test("resources/list + resources/read serve both panels with MCP App shape", async () => {
    const server = createMcpServer();
    const listed = (await server.handleJsonRpc(rpc("resources/list"))) as RpcReply;
    const uris = listed.result.resources.map((resource: { uri: string }) => resource.uri);
    expect(uris).toEqual(["ui://duel/board", "ui://board/notes"]);
    for (const resource of listed.result.resources) {
      expect(resource.mimeType).toBe("text/html;profile=mcp-app;version=1");
    }

    const read = (await server.handleJsonRpc(rpc("resources/read", { uri: "ui://board/notes" }))) as RpcReply;
    const content = read.result.contents[0];
    expect(content.text).toContain("Sticky Board");
    expect(content._meta["io.sitebay.sorti"].layout.slot).toBe("main");

    const missing = (await server.handleJsonRpc(rpc("resources/read", { uri: "ui://duel/none" }))) as RpcReply;
    expect(missing.error?.code).toBe(-32602);
  });

  test("duel.legal_actions reflects the active run", async () => {
    const server = createMcpServer();
    const empty = (await server.handleJsonRpc(rpc("tools/call", { name: "duel.legal_actions" }))) as RpcReply;
    expect(empty.result.structuredContent.actions).toEqual([]);
    await server.handleJsonRpc(rpc("tools/call", { name: "duel.new_run", arguments: {} }));
    const loaded = (await server.handleJsonRpc(
      rpc("tools/call", { name: "duel.legal_actions", arguments: { playerId: "p2" } }),
    )) as RpcReply;
    expect(loaded.result.structuredContent.actions).toEqual([
      { kind: "tap", playerId: "p2" },
      { kind: "boost", playerId: "p2" },
    ]);
  });

  test("unknown method returns -32601", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("prompts/list"))) as RpcReply;
    expect(reply.error?.code).toBe(-32601);
  });
});
