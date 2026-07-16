/**
 * Panel-server aggregator — one MCP App bundling every panel every mounted
 * example ships. Chassis code: you should not need to edit this to add an
 * app; register the app in `examples/index.ts` instead.
 *
 * The registry:
 *   - routes tools/resources by name/URI into the owning panel,
 *   - enforces uniqueness (duplicate URIs/tool names are authoring bugs).
 *
 * Panels never import the MCP wire or touch another panel's state — the
 * registry glues them (PANEL-AUTHORING.md §2).
 */

import type {
  McpAppResource,
  McpAppResourceContent,
  PanelServer,
  PanelToolDefinition,
} from "../../../vendor/sorti-contract/index.ts";

export interface PanelEntry {
  uri: string;
  name: string;
  server: PanelServer;
}

export interface PanelRegistry {
  readonly panels: readonly PanelEntry[];
  readonly tools: readonly PanelToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): ReturnType<PanelServer["callTool"]>;
  readResource(uri: string): ReturnType<PanelServer["readResource"]>;
  listResources(): McpAppResource[];
  getResourceContent(uri: string): McpAppResourceContent | null;
}

export function createPanelRegistry(panels: PanelServer[]): PanelRegistry {
  const entries: PanelEntry[] = panels.map((server) => ({
    uri: server.resource.uri,
    name: server.resource.name,
    server,
  }));

  const uriSet = new Set<string>();
  for (const entry of entries) {
    if (uriSet.has(entry.uri)) throw new Error(`duplicate panel URI: ${entry.uri}`);
    uriSet.add(entry.uri);
  }

  const tools: PanelToolDefinition[] = [];
  const toolOwner = new Map<string, PanelEntry>();
  for (const entry of entries) {
    for (const tool of entry.server.tools) {
      if (toolOwner.has(tool.name)) throw new Error(`duplicate panel tool: ${tool.name}`);
      tools.push(tool);
      toolOwner.set(tool.name, entry);
    }
  }

  const entryByUri = new Map(entries.map((entry) => [entry.uri, entry]));

  return {
    panels: entries,
    tools,
    async callTool(name, args) {
      const owner = toolOwner.get(name);
      if (!owner) throw new Error(`unknown panel tool: ${name}`);
      return owner.server.callTool(name, args);
    },
    async readResource(uri) {
      const owner = entryByUri.get(uri);
      if (!owner) throw new Error(`unknown panel resource: ${uri}`);
      return owner.server.readResource(uri);
    },
    listResources() {
      return entries.map((entry) => entry.server.resource);
    },
    getResourceContent(uri) {
      return entryByUri.get(uri)?.server.resourceContent ?? null;
    },
  };
}
