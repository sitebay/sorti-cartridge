import { describe, expect, test } from "bun:test";
import { createMcpServer, type JsonRpcRequest } from "../src/mcp/server.ts";
import { createRun, type Action } from "../src/game/state.ts";
import { reduce } from "../src/game/reducer.ts";

type RpcReply = { jsonrpc: "2.0"; id?: unknown; result?: any; error?: { code: number; message: string } };

function rpc(method: string, params?: Record<string, unknown>, id: number = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

describe("MCP server", () => {
  test("initialize advertises the contract surface", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("initialize"))) as RpcReply;
    expect(reply.result.protocolVersion).toBe("2024-11-05");
    expect(reply.result.serverInfo.name).toBe("sorti-game-cookie");
    expect(reply.result.capabilities.resources.listChanged).toBe(true);
    expect(reply.result.instructions).toContain("duel.read_state");
  });

  test("tools/list carries the engine tools plus every panel tool", async () => {
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc(rpc("tools/list"))) as RpcReply;
    const names = reply.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["new_run", "legal_actions", "duel.read_state", "duel.tap", "duel.boost"]);
  });

  test("new_run → duel.tap → duel.read_state round-trips through one session", async () => {
    const server = createMcpServer();

    const minted = (await server.handleJsonRpc(
      rpc("tools/call", { name: "new_run", arguments: { seed: 3, targetScore: 4 } }),
    )) as RpcReply;
    expect(minted.result.isError).toBeUndefined();
    const runId = minted.result.structuredContent.runId as string;
    expect(server.runs.has(runId)).toBe(true);

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
    expect(replayed).toEqual(record.state);
  });

  test("illegal actions surface as isError tool results, not thrown 500s", async () => {
    const server = createMcpServer();
    await server.handleJsonRpc(rpc("tools/call", { name: "new_run", arguments: {} }));
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

  test("resources/list + resources/read serve the panel with MCP App shape", async () => {
    const server = createMcpServer();
    const listed = (await server.handleJsonRpc(rpc("resources/list"))) as RpcReply;
    expect(listed.result.resources).toHaveLength(1);
    const resource = listed.result.resources[0];
    expect(resource.uri).toBe("ui://duel/board");
    expect(resource.mimeType).toBe("text/html;profile=mcp-app;version=1");

    const read = (await server.handleJsonRpc(rpc("resources/read", { uri: resource.uri }))) as RpcReply;
    const content = read.result.contents[0];
    expect(content.text).toContain("Tally Duel");
    expect(content._meta["io.sitebay.sorti"].layout.slot).toBe("main");

    const missing = (await server.handleJsonRpc(rpc("resources/read", { uri: "ui://duel/none" }))) as RpcReply;
    expect(missing.error?.code).toBe(-32602);
  });

  test("legal_actions reflects the active run", async () => {
    const server = createMcpServer();
    const empty = (await server.handleJsonRpc(rpc("tools/call", { name: "legal_actions" }))) as RpcReply;
    expect(empty.result.structuredContent.actions).toEqual([]);
    await server.handleJsonRpc(rpc("tools/call", { name: "new_run", arguments: {} }));
    const loaded = (await server.handleJsonRpc(
      rpc("tools/call", { name: "legal_actions", arguments: { playerId: "p2" } }),
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
