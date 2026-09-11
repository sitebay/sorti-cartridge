import { describe, expect, test } from "bun:test";
import { ALWAYS_LOAD_TOOLS, buildByoCapabilities, buildPanelManifest } from "../src/mcp/manifest.ts";
import { ALWAYS_LOAD_META_KEY, createMcpServer } from "../src/mcp/server.ts";

describe("capabilities + manifest", () => {
  test("byo capabilities doc has the activation-critical fields", () => {
    const caps = buildByoCapabilities("0.1.0");
    expect(caps.kind).toBe("byo-mcp");
    expect(caps.kind_version).toBe("1");
    expect(caps.panels).toEqual([{ uri: "ui://duel/board" }, { uri: "ui://board/notes" }]);
    expect(caps.multiplayer).toEqual({ supported: false });
    for (const specialist of caps.specialists) {
      expect(specialist.tools.length).toBeLessThanOrEqual(12);
    }
  });

  test("every advertised tool is claimed by exactly one module (allowed-tool cap)", () => {
    const caps = buildByoCapabilities();
    const manifest = buildPanelManifest();
    const claimed = caps.modules.flatMap((module) => module.tools);
    const advertised = manifest.contracts.tools.map((tool) => tool.name);
    expect([...claimed].sort()).toEqual([...advertised].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const module of caps.modules) {
      expect(module.tools.length).toBeLessThanOrEqual(20);
    }
  });

  test("one capability module per example prefix", () => {
    const caps = buildByoCapabilities();
    expect(caps.modules.map((module) => module.id).sort()).toEqual(["board", "duel"]);
  });

  // ── S5a re-cut arms (sts2 9d02a1fe) ──────────────────────────────────
  test("alwaysLoadTools is ONE declaration, pinned to the wire in BOTH directions", async () => {
    const caps = buildByoCapabilities();
    expect(caps.coop?.alwaysLoadTools).toEqual([...ALWAYS_LOAD_TOOLS]);
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc({
      jsonrpc: "2.0", id: 1, method: "tools/list",
    })) as { result: { tools: { name: string; _meta?: Record<string, unknown> }[] } };
    const stamped = reply.result.tools
      .filter((tool) => tool._meta?.[ALWAYS_LOAD_META_KEY] === true)
      .map((tool) => tool.name);
    // Direction 1: everything the document promises is actually stamped.
    expect([...stamped].sort()).toEqual([...caps.coop!.alwaysLoadTools].sort());
    // Direction 2: nothing is stamped that the document does not promise.
    for (const name of stamped) expect(caps.coop!.alwaysLoadTools).toContain(name);
    // And every name is a tool this server actually serves.
    const served = new Set(reply.result.tools.map((tool) => tool.name));
    for (const name of caps.coop!.alwaysLoadTools) expect(served.has(name)).toBe(true);
  });

  test("the capabilities doc embeds the app manifest, quick actions and all", () => {
    const caps = buildByoCapabilities();
    expect(caps.manifest?.id).toBe("sorti-cartridge");
    expect(caps.manifest?.name).toBe("Sorti Cartridge");
    expect(caps.manifest?.panels).toEqual(caps.panels.map((panel) => panel.uri));
    const quick = caps.manifest?.quickActions ?? [];
    expect(quick.length).toBeGreaterThan(0);
    const served = new Set(buildPanelManifest().contracts.tools.map((tool) => tool.name));
    for (const action of quick) {
      expect(served.has(action.tool)).toBe(true);
      // A destructive launcher action must carry BOTH prompts, or a host that
      // honours guardLiveRun has nothing to send on the resume arm.
      if (action.guardLiveRun) {
        expect(typeof action.agentPrompt).toBe("string");
        expect(typeof action.resumePrompt).toBe("string");
      }
    }
  });

  // ── S5b-2: the bar probes what the app declares safe ────────────────────
  test("every example declares a probe tool, and the document publishes it", async () => {
    const caps = buildByoCapabilities();
    const declared = caps.conformance?.probeTools ?? [];
    // One per example, or the bar falls back to guessing from our schemas.
    expect(declared).toEqual(["duel.read_state", "board.read_state"]);
    // Every name is a tool this server actually answers…
    const server = createMcpServer();
    const reply = (await server.handleJsonRpc({
      jsonrpc: "2.0", id: 1, method: "tools/list",
    })) as { result: { tools: { name: string; inputSchema?: { required?: string[] } }[] } };
    const served = new Map(reply.result.tools.map((tool) => [tool.name, tool]));
    for (const name of declared) expect(served.has(name)).toBe(true);
    // …and every one is callable with NOTHING, which is the promise the
    // declaration makes to a bar that calls it against production.
    for (const name of declared) {
      expect(served.get(name)!.inputSchema?.required ?? []).toEqual([]);
    }
  });

  test("a probe tool changes nothing — calling it twice leaves no run behind", async () => {
    const server = createMcpServer();
    for (const name of buildByoCapabilities().conformance?.probeTools ?? []) {
      const reply = (await server.handleJsonRpc({
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} },
      })) as { result: { isError?: boolean; structuredContent?: { active?: boolean } } };
      expect(reply.result.isError ?? false).toBe(false);
      // A read on an empty server reports no run AND mints none.
      expect(reply.result.structuredContent?.active).toBe(false);
      expect(server.runs.size).toBe(0);
    }
  });

  test("screenGroups merge across examples and only reference declared panels", () => {
    const caps = buildByoCapabilities();
    expect(Object.keys(caps.screenGroups ?? {}).sort()).toEqual(["board", "duel", "game_over"]);
    const uris = new Set(caps.panels.map((panel) => panel.uri));
    for (const group of Object.values(caps.screenGroups ?? {})) {
      for (const uri of group) expect(uris.has(uri)).toBe(true);
    }
  });
});
