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
 *   - Coop agent-policy seam (`Policy`, `RoomSnapshot`, `RoomOpDraft`,
 *     `PolicyAttention`, `EphemeralAnchor`, ...)
 *   - App self-description (`SortiAppManifest`, `SORTI_APP_MANIFEST_URI`) —
 *     the launcher entry a host renders without hardcoded knowledge
 *
 * When your app is installed next to a real published contract package,
 * delete this directory and point the `@sitebay/sorti-contract` import map
 * (tsconfig `paths` + package.json) at the real one. Shapes here are frozen
 * against contract v1.1.0 (the `@sitebay/sorti-contract` package, re-synced
 * from commit 77a5a11f8, 2026-09-11); do not extend them locally.
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

/**
 * Stable resource URI a Sorti-aware MCP server publishes to self-describe as a
 * workspace-class app. Hosts discover apps by resolving this URI on each
 * connected server; a server that does not publish it is treated as a
 * panel-only provider. A cartridge answers with the SAME document it embeds in
 * its capabilities doc, so activation costs no second round trip.
 */
export const SORTI_APP_MANIFEST_URI = "sorti-app://manifest" as const;

/**
 * A launcher action owned by the app server — the buttons a host draws beside
 * the app's tile ("\u25b6 Open", "\ud83c\udfae New Game with Sorti").
 *
 * THE APP OWNS THIS. `agentPrompt`, `resumePrompt` and `guardLiveRun` are here
 * because without them the only place they COULD be said was the HOST's own
 * catalog — which is how Sorti came to carry a hand-copy of one app's launcher
 * actions until 2026-09-03.
 */
export type SortiAppQuickAction = {
  id: string;
  label: string;
  /** Tool the host calls when the button is pressed. */
  tool: string;
  title?: string;
  successMessage?: string;
  /**
   * After the tool call, send this text to the agent as a user turn so it
   * ACTS. Without it a tool like "start a new run" is INVISIBLE to the agent,
   * which then reports "nothing loaded yet" at a table that just started.
   */
  agentPrompt?: string;
  /**
   * This action is DESTRUCTIVE to work in progress. With a live run the host
   * must skip the tool call and open the app's current screen instead.
   */
  guardLiveRun?: boolean;
  /**
   * Sent INSTEAD of `agentPrompt` when `guardLiveRun` found a live run — tells
   * the agent to JOIN what is already running, never to start a second one
   * (which splits the seats into different games).
   */
  resumePrompt?: string;
};

/**
 * Self-description an MCP App server publishes so hosts can render a launcher
 * entry without hardcoded knowledge. Subset: the fields a cartridge fills.
 */
export type SortiAppManifest = {
  /** Stable id (matches the server id). Used as the workspace tab key. */
  id: string;
  name: string;
  description?: string;
  /** Single-grapheme glyph rendered in the launcher tile and tab bar. */
  glyph?: string;
  /** Hex accent color for the tile background and tab underline. */
  color?: string;
  presentation?: "workspace" | "inline" | "doc";
  /** Resource URIs to auto-mount when the app opens. Absent = every UI resource. */
  panels?: string[];
  category?: string;
  quickActions?: SortiAppQuickAction[];
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

/**
 * The seat role lattice: `player` acts, `coach` suggests (drafts surface as
 * proposals, nothing dispatches), `spectator` observes.
 */
export type CoopSeatRole = "player" | "coach" | "spectator";

/** A seat as seen in a room snapshot. */
export interface RoomSeat {
  id: string;
  kind: string;
  /**
   * `name` and `color` are the seat's PRESENCE identity — a room that
   * populates them gets who's-here chips and peer halos in every host with
   * zero app code; a room that omits them renders anonymous.
   */
  meta?: { role?: CoopSeatRole; name?: string; color?: string; [key: string]: unknown };
}

/** Room snapshot as returned by the coop state subscription. */
export interface RoomSnapshot<S = unknown> {
  roomId: string;
  state: S;
  /**
   * The op log TAIL. Once a room compacts this is NOT the full history — ops
   * `[0, baseSeq)` have been folded into `state`.
   */
  log: unknown[];
  accepted: string[];
  seats: RoomSeat[];
  /**
   * How many ops are folded into `state` — the seq of the first op in `log`.
   * Absent or 0 = nothing compacted. Load-bearing for any policy deriving a
   * MONOTONIC quantity from the log: `log.length` alone resets and cycles once
   * a room compacts, so a seed or counter built on it silently repeats.
   * `baseSeq + log.length` is the compaction-invariant form.
   */
  baseSeq?: number;
  /** Fully-formed dispatchable actions derived from `state` by the domain. */
  legalActions?: unknown[];
  /**
   * The app's YIELD RULE as data — advisory and safe in the only direction
   * that matters: the worst a hostile declaration achieves is a quieter seat.
   * Malformed or absent means no yielding.
   */
  yieldPolicy?: unknown;
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
  /**
   * Optional edit-group: sub-ops this draft applies as ONE unit. Where the
   * room's substrate is transactional the group applies ATOMICALLY — one seq,
   * one undo boundary; where it is not, the adapter applies sequentially and
   * stops at the first failure. Either way: ONE yield decision, ONE journal
   * identity, ONE label for N related edits.
   */
  group?: Array<{ kind: string; payload: P }>;
  /**
   * Per-target supersession identity. A later draft with the same
   * `conflictKey` supersedes an earlier UNAPPLIED one. Applied history is
   * never rewritten by this key — supersession is for work that has not landed.
   */
  conflictKey?: string;
  /**
   * GENERATION GATE: shared-state fields this draft was decided against, which
   * the authority re-checks before applying it. A decision made against state
   * N must not be applied at state N+1 — most stale drafts are harmless (the
   * reducer bounces them) but an `end_turn`-class op stays LEGAL while changing
   * MEANING. Deliberately per-field and NOT blanket sequence equality, which
   * would refuse this seat's ops exactly when the partner is most active.
   * Absent = no gate.
   */
  precondition?: Record<string, string | number | boolean | null>;
}

/**
 * Where an ephemeral frame points. EXACTLY ONE anchor: the anchor space names
 * the renderer, and dual carriage is how two renderers come to paint one fact.
 */
export type EphemeralAnchor =
  | { type: "selector"; selector: string }
  | { type: "entityId"; entityId: string }
  | { type: "xy"; x: number; y: number }
  | { type: "nodeId"; nodeId: string };

/**
 * Where a seat's attention is, for the ephemeral halo lane — the DECLARED half
 * of presence, as opposed to the derived half a host infers from tool events.
 *
 * BOTH FIELDS ARE APP VOCABULARY, which is why both come from the policy and
 * neither is guessed by the driver. An `entityId` names a thing only your app
 * can resolve; a `surfaceId` names WHICH of your panels that thing is on. An
 * app that cannot name its own surface names none, and the frame lands
 * unscoped rather than wrongly scoped.
 */
export interface PolicyAttention {
  /** The panel uri the attention is ON. Absent = unscoped; nothing draws it. */
  surfaceId?: string;
  anchor: EphemeralAnchor;
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
  /**
   * OPTIONAL: where this seat's attention is, given the op it just decided.
   * The driver publishes the answer on the unreliable ephemeral lane so peers
   * see your seat's hand BEFORE the op lands. A domain that does not implement
   * it emits no frames at all — which is why it is a hook rather than an
   * inference: a driver that mined attention out of `draft.payload` would be
   * inventing entity ids on your app's behalf.
   *
   * PURE AND SYNCHRONOUS. It runs on the decision path immediately before the
   * op is proposed; it must not await, must not mutate, and a throw is
   * swallowed by the driver. Return null when the op has no visible target.
   */
  attention?(draft: RoomOpDraft<P>, snapshot: RoomSnapshot<S>, seatId: string): PolicyAttention | null;
}

/** Domain-neutral dependencies handed to a policy at construction. */
export interface CoopPolicyDeps {
  askLlm?: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ) => Promise<string | null>;
  /** The app's operating manual (MCP `initialize` instructions). */
  gameManual?: string;
  /**
   * Deterministic offer chooser: given the seat's legal offers and the
   * snapshot, return the index to take, or null to hold. The LLM-free default
   * brain a policy may fall back to when `askLlm` is absent — a handler pick,
   * never entropy (a stochastic seat cannot be bisected).
   */
  chooseOffer?: (offers: unknown[], snapshot: unknown) => number | null;
  /**
   * Accumulated preferences for this app — the taste layer. `gameManual` is
   * the app authors' doctrine and is identical for everyone; this is the delta
   * the agent has learned about the person it is playing with. Like the manual
   * it is ADVICE the model weighs, never legality: ops are still selected from
   * the app's own offered actions, so no playbook line can make an illegal
   * move legal.
   */
  playbook?: string;
  /**
   * THE PLAN THE PERSON AND SORTI'S CHAT BRAIN AGREED, in their own words —
   * one sentence, replaced not appended, absent when nothing was agreed.
   *
   * Sorti sits at your app twice: a chat brain that talks to the person, and a
   * SEAT that plays on its own tick. Only the seat reaches your tools, and only
   * the chat brain hears the conversation — so a strategy settled in words ("go
   * aggressive this fight") reached the half of Sorti that cannot play it.
   * This is that sentence, handed down.
   *
   * ⛔ READ IT AT DECIDE TIME, NEVER AT CONSTRUCTION. Your policy is built once
   * and the person changes their mind mid-session; a host may hand you this as
   * a GETTER on the deps object, and Sorti does.
   *
   * ADVICE, LIKE THE MANUAL AND THE PLAYBOOK — never legality. Honour a
   * directive you RECOGNISE and ignore one you do not: a guessed
   * interpretation is wrong exactly when it matters, and no sentence a person
   * types can make an illegal move legal.
   */
  guidance?: string;
}

/** Factory producing a fresh participant policy for a domain. */
export type CoopPolicyFactory = (deps?: CoopPolicyDeps) => Policy<unknown, unknown>;
