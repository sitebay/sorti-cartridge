import { describe, expect, test } from "bun:test";
import { buildByoCapabilities, buildPanelManifest } from "../src/mcp/manifest.ts";

describe("capabilities + manifest", () => {
  test("byo capabilities doc has the activation-critical fields", () => {
    const caps = buildByoCapabilities("0.1.0");
    expect(caps.kind).toBe("byo-mcp");
    expect(caps.kind_version).toBe("1");
    expect(caps.panels).toEqual([{ uri: "ui://duel/board" }]);
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

  test("screenGroups only reference declared panels", () => {
    const caps = buildByoCapabilities();
    const uris = new Set(caps.panels.map((panel) => panel.uri));
    for (const group of Object.values(caps.screenGroups ?? {})) {
      for (const uri of group) expect(uris.has(uri)).toBe(true);
    }
  });
});
