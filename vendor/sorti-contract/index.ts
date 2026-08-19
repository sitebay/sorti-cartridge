/**
 * Vendored @sitebay/sorti-contract shim — the minimal, shape-faithful subset
 * this cartridge needs to compile and run WITHOUT the sorti monorepo.
 *
 * `@sitebay/sorti-contract` (and `@mcp-apps-contract` underneath it) are
 * workspace packages that are not published to npm. Everything below is a
 * byte-level-compatible copy of the symbols the panel chassis uses:
 *
 *   - MCP App resource types (`McpAppResource`, `McpAppResourceContent`,
 *     `MCP_APP_RESOURCE_MIME_TYPE`, `SORTI_META_NAMESPACE`)
 *   - Panel server contract (`PanelServer`, `PanelToolDefinition`,
 *     `CallToolResult`, `createCallToolResult`)
 *   - Native-panel + client-engine registries (`registerNativePanel`,
 *     `registerClientEngine`, ...) — same signatures as
 *     `packages/mcp-apps-contract/src/nativePanels.ts`
 *   - Coop agent-policy seam (`Policy`, `RoomSnapshot`, `RoomOpDraft`, ...)
 *
 * When your app is installed next to a real published contract package,
 * delete this directory and point the `@sitebay/sorti-contract` import map
 * (tsconfig `paths` + package.json) at the real one. Shapes here are frozen
 * against contract v1.0.0; do not extend them locally.
 */

// ── MCP wire ────────────────────────────────────────────────────────────

/** One item in `CallToolResult.content[]` (goes into the model's context). */
export type ToolContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Two-carrier tool result: `content[]` is for the model,
 * `structuredContent` is forwarded verbatim to the panel iframe.
 */
export type CallToolResult = {
  content: ToolContentItem[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Builds the RFC-002 tools/call result envelope for panel-facing payloads. */
export function createCallToolResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value ?? null);
  const result: CallToolResult = { content: [{ type: "text", text }] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    result.structuredContent = value as Record<string, unknown>;
  }
  return result;
}

// ── MCP App resources ───────────────────────────────────────────────────

/** MIME type required on MCP App resource content (host pins `;version=1`). */
export const MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app;version=1" as const;

/** Reserved Sorti namespace key under MCP `_meta`. */
export const SORTI_META_NAMESPACE = "io.sitebay.sorti" as const;

/** Resource-level CSP declared by MCP App servers. Host enforces it. */
export type McpAppCsp = {
  /** fetch / XHR / WebSocket origins. */
  connectDomains?: string[];
  /** scripts, images, styles, fonts, media. */
  resourceDomains?: string[];
  /** nested iframes; default 'none'. */
  frameDomains?: string[];
  /** base-uri directive; default 'self'. */
  baseUriDomains?: string[];
};

/** Permissions a panel requests for the inner iframe `allow` attribute. */
export type McpAppPermissions = {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
};

/** Host-neutral layout role. */
export type PanelLayoutRole =
  | "primary-canvas"
  | "inspector"
  | "tool-rail"
  | "log"
  | "status"
  | "modal"
  | "ambient"
  | "canvas-overlay";

/** Sorti-host display slot. */
export type SlotId =
  | "main"
  | "side"
  | "side.upper"
  | "side.lower"
  | "top"
  | "top.primary"
  | "top.secondary"
  | "bottom.dock"
  | "modal";

/** Layout hint a panel server may declare under `_meta["io.sitebay.sorti"].layout`. */
export type SortiLayoutMeta = {
  slot: SlotId;
  role?: PanelLayoutRole;
  /** Whether the host should currently mount/render this panel. */
  active?: boolean;
  /** Tab/window title; falls back to server's displayName. */
  title?: string;
  /** Lucide icon name. */
  icon?: string;
  resizable?: boolean;
  /** Multi-panel ordering inside a slot; lower = earlier. */
  stackOrder?: number;
};

/** Drag opt-in a panel declares (payload types this panel emits/accepts). */
export type SortiPanelDragMeta = {
  sources?: string[];
  targets?: string[];
};

/**
 * A panel's request for a client-side prediction bundle. Mirrors the real
 * contract's `SortiClientEngineRequest` (an EXCLUSIVE union — declaring both
 * arms is a type error there and now here too).
 *
 * ⛔ NEITHER ARM WORKS FOR A DEPLOYED CARTRIDGE TODAY. `engineId` resolves
 * against a registry the HOST populates inside its own build, which a cartridge
 * on your own account is never part of; `{ url, version }` is the BYO lane, but
 * the host only resolves either form for `panelKind: "l3-bundle"` panels, and
 * cartridge panels are HTML templates. Typed here so a declaration is at least
 * well-formed and so this comment sits where someone would write one. See
 * PANEL-AUTHORING.md "Prediction" for the four measurements, and
 * tests/prediction-seam.test.ts for the gate that fails on an unbacked claim.
 */
export type SortiClientEngineRequest =
  | { engineId: string; url?: never; version?: never }
  | { url: string; version: string; engineId?: never };

/** Sorti-private MCP App resource metadata under `_meta["io.sitebay.sorti"]`. */
export type SortiAppMeta = {
  layout?: SortiLayoutMeta;
  drag?: SortiPanelDragMeta;
  /** Client-side prediction request. Read the type's header before declaring one. */
  clientEngine?: SortiClientEngineRequest;
  /** Open extension point (savestate, channels, ...). */
  [key: string]: unknown;
};

export type McpAppUiMeta = {
  csp?: McpAppCsp;
  permissions?: McpAppPermissions;
  prefersBorder?: boolean;
  /**
   * Which host lane renders this panel. Omitted (or `"html"`) is the sandboxed
   * iframe every cartridge example uses. `"l3-bundle"` means `text` carries a
   * `definePanel` IIFE the host evaluates against its own primitive renderer —
   * the ONLY lane in which the host reads a `clientEngine` declaration. Building
   * one needs `@sitebay/panel-author` + react + react-reconciler, which this
   * repo deliberately does not depend on.
   */
  panelKind?: "html" | "primitive-spec" | "l3-bundle";
  /** `l3-bundle` only: the read tool the host pumps into the bundle's `setHostState`. */
  l3StateTool?: string;
  [key: string]: unknown;
};

export type McpAppResourceMeta = {
  ui?: McpAppUiMeta;
  [SORTI_META_NAMESPACE]?: SortiAppMeta;
  [key: string]: unknown;
};

/** Resource-list entry for a UI resource. Content arrives via resources/read. */
export type McpAppResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType: typeof MCP_APP_RESOURCE_MIME_TYPE;
  schemaVersion?: 1 | 2;
  _meta?: McpAppResourceMeta;
};

/** A spec-compliant MCP App resource content item. HTML rides in `text`. */
export type McpAppResourceContent = {
  uri: string;
  mimeType: typeof MCP_APP_RESOURCE_MIME_TYPE;
  schemaVersion?: 1 | 2;
  text?: string;
  blob?: string;
  _meta?: McpAppResourceMeta;
};

/** Tool metadata for MCP Apps. */
export type McpAppToolMeta = {
  resourceUri?: string;
  visibility?: Array<"model" | "panel">;
};

// ── Panel server contract ───────────────────────────────────────────────

export type PanelToolHandler = (args: unknown) => Promise<unknown> | unknown;

/**
 * The subset of MCP's standard tool annotations that carries policy weight.
 * Faithful to `packages/mcp-apps-contract/src/appPolicy.ts`.
 *
 * Tri-state on purpose: `undefined` is "the server made no claim", which is a
 * different fact from `false` and must never collapse into it.
 */
export type McpToolAnnotations = {
  /** The server declares this tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** The server declares this tool may perform destructive updates. */
  destructiveHint?: boolean;
  /** The server declares repeated calls with the same args have no extra effect. */
  idempotentHint?: boolean;
  /** The server declares the tool touches an open world (search, fetch, …). */
  openWorldHint?: boolean;
  /** Human-facing title, carried so a policy reader need not re-fetch the tool. */
  title?: string;
};

export type PanelToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  /**
   * MCP's standard tool annotations — what this tool says about ITSELF.
   *
   * Re-synced from the real contract (`mcp-apps-contract/src/panels.ts`), not
   * invented here: until the field existed upstream a first-party panel
   * physically could not describe its own tools, so a panel read and a panel
   * write were the same unlabelled thing to every reader downstream. A
   * cartridge panel could not declare one either, purely because this shim
   * lagged.
   *
   * `undefined` is "no claim" and is a different fact from `false`. Declaring
   * `readOnlyHint: true` is a claim about YOUR handler, and unlike a remote
   * server's it is checkable against the handler — so only declare it if the
   * handler is genuinely pure. It is NOT a trust lever: nothing downstream
   * softens a consent decision because of it.
   */
  annotations?: McpToolAnnotations;
  _meta?: { ui?: McpAppToolMeta };
  handler: PanelToolHandler;
};

export type PanelServer = {
  /** Resource list entry. URI is the panel's stable identity. */
  resource: McpAppResource;
  /** Resource content returned by `resources/read`. Spec-shape; HTML in `text`. */
  resourceContent: McpAppResourceContent;
  /** Tools the iframe may invoke via the proxy topic. */
  tools: PanelToolDefinition[];
  callTool: (name: string, args: unknown) => Promise<CallToolResult>;
  readResource: (uri: string) => Promise<McpAppResourceContent>;
};

// ── Native panel + client-engine registries ─────────────────────────────
// Faithful to packages/mcp-apps-contract/src/nativePanels.ts: a pure registry
// of opaque renderer callbacks; no React types at the contract layer.

export type NativePanelMcpFetch = (
  endpoint: string,
  method: string,
  params?: Record<string, unknown>,
) => Promise<{ result?: unknown; error?: unknown }>;

export type NativePanelDescriptor = {
  uri: string;
  endpoint: string;
  serverId: string;
  slot: string;
  title: string;
  stackOrder: number;
  activeByDefault: boolean;
  dragSources: string[];
  dragTargets: string[];
};

export type NativePanelContext<TDragPayload = unknown> = {
  panel: NativePanelDescriptor;
  mcpFetch: NativePanelMcpFetch;
  dragOver?: { active: boolean; dragType?: string; payload?: TDragPayload; x?: number; y?: number } | null;
  startDrag?: <TDragType extends string, TPayload>(dragType: TDragType, payload: TPayload) => void;
  onLocalDrop?: (targetId: string | null, payload: TDragPayload) => void;
  refreshKey?: number;
  clientStore?: unknown;
  onReportBounds?: (report: unknown) => void;
  beginCardFlight?: (request: unknown) => void;
  clientEngineVersion?: string;
  onViewModel?: (viewModel: unknown) => void;
  avatarRenderer?: unknown;
};

/** Renderer returns whatever the host can render — typically a React node. */
export type NativePanelRenderer = (ctx: NativePanelContext) => unknown;

const nativePanelRegistry = new Map<string, NativePanelRenderer>();

export function registerNativePanel(uri: string, renderer: NativePanelRenderer): void {
  nativePanelRegistry.set(uri, renderer);
}

export function getNativePanelRenderer(uri: string): NativePanelRenderer | undefined {
  return nativePanelRegistry.get(uri);
}

export function getNativeRenderers(): Record<string, NativePanelRenderer> {
  return Object.fromEntries(nativePanelRegistry);
}

/** Reducer bundle an app registers so host panels can predict client-side. */
export type ClientEngineBundle =
  | { source: string; version: string; url?: never }
  | { url: string; version: string; source?: never };

const clientEngineRegistry = new Map<string, ClientEngineBundle>();

export function registerClientEngine(engineId: string, bundle: ClientEngineBundle): void {
  clientEngineRegistry.set(engineId, bundle);
}

export function getClientEngine(engineId: string): ClientEngineBundle | undefined {
  return clientEngineRegistry.get(engineId);
}

// ── Coop agent-policy seam ──────────────────────────────────────────────
// The generic agent-side DECISION seam ("what should I do on this snapshot?").
// The agent host (sorti-agent) supplies the driver + transport; the app
// supplies a Policy per domain via its `./coop` export.

/** A seat as seen in a room snapshot. */
export interface RoomSeat {
  id: string;
  kind: string;
  meta?: { role?: string; name?: string; color?: string; [key: string]: unknown };
}

/** Room snapshot as returned by the coop state subscription. */
export interface RoomSnapshot<S = unknown> {
  roomId: string;
  state: S;
  log: unknown[];
  accepted: string[];
  seats: RoomSeat[];
  /** Fully-formed dispatchable actions derived from `state` by the domain. */
  legalActions?: unknown[];
}

/** A transient co-op signal, mapped by adapters to their own side-channel tools. */
export interface RoomSignalDraft {
  tool: string;
  payload: Record<string, unknown>;
}

export type RoomOpTier = "observe" | "act" | "execute" | "consent-gated";

/** An op the policy wants to propose (seq is assigned by the driver). */
export interface RoomOpDraft<P = unknown> {
  kind: string;
  payload: P;
  label?: string;
  reason?: string;
  speak?: boolean;
  undoable?: boolean;
  before?: RoomSignalDraft[];
  tier?: RoomOpTier;
  decidedBy?: "llm" | "heuristic" | "auto";
  conflictKey?: string;
}

/**
 * The domain plug: should I act on this snapshot, and what op to take.
 * `shouldAct` is NOT a turn gate in simultaneous games; `decide` returns one
 * op per tick (or null to pass) so the driver re-reads state between actions.
 */
export interface Policy<S, P = unknown> {
  shouldAct(snapshot: RoomSnapshot<S>, seatId: string): boolean;
  decide(
    snapshot: RoomSnapshot<S>,
    seatId: string,
  ): Promise<RoomOpDraft<P> | null> | (RoomOpDraft<P> | null);
}

/** Domain-neutral dependencies handed to a policy at construction. */
export interface CoopPolicyDeps {
  askLlm?: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ) => Promise<string | null>;
  /** The app's operating manual (MCP `initialize` instructions). */
  gameManual?: string;
  chooseOffer?: (offers: unknown[], snapshot: unknown) => number | null;
}

/** Factory producing a fresh participant policy for a domain. */
export type CoopPolicyFactory = (deps?: CoopPolicyDeps) => Policy<unknown, unknown>;
