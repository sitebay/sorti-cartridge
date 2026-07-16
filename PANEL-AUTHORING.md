# Authoring Sorti panels — the contract behind STS2

This is the reference for building a **Sorti panel app** (a "BYO MCP" app that
ships interactive UI panels the agent and user share). STS2 is the worked
example; this document extracts the *contract* so you can build your own without
reverse-engineering 30 panel servers.

> Read this end-to-end once. The patterns here are load-bearing — they're what
> make a panel deterministic, replayable, agent-drivable, and safe to embed.

---

## 1. The mental model

A panel app is an **MCP server** that exposes three things to the Sorti host:

1. **Tools** — JSON-RPC `tools/call` endpoints. Two flavors: *reads*
   (`<panel>.read_state`, pure, no mutation) and *actions* (mutate state).
2. **Resources** — `resources/read` returning a panel's **HTML template** by
   `ui://` URI. The host mounts it in a sandboxed iframe.
3. **Capabilities** — a `/.well-known/byo-mcp/capabilities.json` document that
   tells the host what modules/tools/specialists/panels you offer.

The host is **data-driven**: it never hardcodes knowledge of your app. It reads
your capabilities + each resource's `_meta` and acts accordingly. If you find
yourself needing the host to "know about" your app, you're off the path.

```
Sorti host  ──initialize──▶  your MCP server  (instructions + capabilities)
            ──tools/list──▶
            ──resources/read ui://you/panel──▶  HTML template (sandboxed iframe)
   iframe  ──tools/call you.read_state──▶  ViewModel (JSON) ──▶ iframe renders
   agent   ──tools/call you.do_thing──▶  reducer mutates state ──▶ host refreshes panels
```

---

## 2. The PanelServer contract

Every panel is a factory returning a `PanelServer`:

```ts
interface PanelServer {
  resource: McpAppResource;                    // the ui:// resource + _meta
  tools: PanelToolDefinition[];                // read_state + actions
  callTool(name, args): unknown | Promise<unknown>;
  readResource(uri): McpAppResourceContent | null;
}
```

Build it with a **factory that takes injected deps** — never reach for globals:

```ts
export function createMyPanelServer(deps: {
  dispatch: (runId, action) => { state; events };   // the ONE mutation path
  getState: () => GameState | null;                  // current authoritative state
  notifyResourcesChanged?: () => void;               // tell host layout changed
}): PanelServer { /* ... */ }
```

See `src/mcp/panels/spec/registry.ts:175` for how STS2 injects `dispatch` once and
reuses it across every panel. **Panels never import the MCP wire or touch another
panel's state** — the registry glues them.

---

## 3. THE STATE-OWNERSHIP RULE (read this twice)

The single rule that copiers get wrong. Every piece of state has exactly **one**
home; pick by what the state *is*:

| Kind of state | Home | Replayed? | Example |
|---|---|---|---|
| **Authoritative game/app state** | `GameState` (via the reducer) | ✅ yes (action log) | HP, deck, gold, current screen |
| **Pre-run / lobby / draft config** | the **session object** (`CompanionSessionState`) | ❌ no | character-select choices, scenario draft |
| **Transient coordination signals** | a **side-journal** (own module) | ❌ no | map drawings, coop telegraphs, pings |

Rules:
- If replaying the action log must reproduce it → it belongs in `GameState`. Put
  nothing else there.
- If it's a choice made *before* a run exists, or UI scaffolding → session object.
- If it's an ephemeral hint that must NOT change the game → side-journal
  (`src/mcp/coop-intent-journal.ts`, `map-drawing-journal.ts` are the templates).

Why it matters: the engine worker is **stateless per request** and rebuilds your
panel server on every call. Only `GameState` (carried in snapshots/op-log) and the
persisted session survive. State stashed in a module global or a closure **is lost
on the next request** — the #1 "my panel forgets things" bug.

---

## 4. ViewModels and `read_state` (render data, not code)

A panel's iframe renders a **ViewModel** — plain JSON — never reaches into engine
internals. Export a **pure** projector and expose it as `read_state`:

```ts
export function computeMyViewModel(state: GameState, deps): MyViewModel { /* pure */ }

const readState: PanelToolDefinition = {
  name: "my_panel.read_state",
  inputSchema: { type: "object", properties: {} },
  handler: () => computeMyViewModel(getState(), deps),   // no mutation, ever
};
```

Conventions the host relies on:
- Read tools are named `<panel>.read_state` (dotted) — the host treats this name
  as a pure read for refresh/caching and (in coop) scopes it to the viewer's seat.
- The VM is **self-contained**: everything the template needs, already computed.
  No "the template will call back for X." One read = one full paint.
- Keep it JSON-serializable and deterministic. No `Date.now()`, no `Map`/`Set` in
  the VM, no functions.

`src/mcp/panels/spec/combat/server.ts:378` is the reference projector.

---

## 5. The HTML template + the panel runtime

Each panel ships a complete, self-contained HTML document (inlined CSS + JS). It
runs in a sandboxed iframe and talks to the host via `postMessage`. Use the
**SortiPanel runtime** (the host injects/expects it) instead of hand-rolling the
protocol:

```js
const panel = window.SortiPanel;
await panel.init({ uri: "ui://you/panel", onState: render });   // subscribe to VM
async function onClick() { await panel.rpc("tools/call", { name: "you.do_thing", arguments: {} }); }
```

The runtime also answers `sorti/capture` (workspace screenshots) for you — so the
agent can *see* your panel. (BYO panels that don't carry the runtime get a capture
shim injected host-side; see `apps/sorti/lib/panels/byoCapturePreamble.ts` in the
Sorti repo.) Templates are **source, not generated** — keep them readable; the
`.gen.ts` wrappers are just `export { TEMPLATE_HTML }`.

---

## 6. `_meta` — how the host places and wires your panel

Declare layout + affordances under the `io.sitebay.sorti` namespace on the
resource `_meta`. The host reads it; you never call host layout APIs.

```ts
_meta: {
  ui: { csp: { connectDomains: [], resourceDomains: ["https://fonts.gstatic.com"], frameDomains: [], baseUriDomains: [] }, permissions: {} },
  "io.sitebay.sorti": {
    layout: { slot: "main", role: "primary-canvas", title: "My Panel", icon: "swords", stackOrder: 0, resizable: false },
    drag:   { sources: [], targets: [] },
  },
}
```

- **`layout.slot`**: `main | side | top`. `role`/`stackOrder`/`title`/`icon` are hints.
- **`drag`**: declare drag sources/targets to participate in cross-panel DnD.
- **`csp`**: least-privilege. `resourceDomains` widens script/style/img/font/media;
  `connectDomains` widens fetch. The sandbox baseline already allows the capture
  CDN — declare only what *your* content needs. Don't copy a kitchen-sink CSP.
- **Capabilities**: advertise engine affordances (undo/snapshot/prediction) under
  your own `io.sitebay.<app>` key so the host can surface them generically.

---

## 7. Mods / custom content (the validate → apply → embark order)

If your app supports user/agent-authored content, expose it as a **pure-data pack
schema** + `validate` / `apply` tools (the BYO `content` capability). STS2's order,
which you should mirror:

1. **`new_run`** (or your equivalent) — creates the active run.
2. **`mods.validate_pack`** then **`mods.apply_pack`** — apply needs an *active
   run*; the pack is action-logged so replay reconstructs it.
3. Reference the modded content (e.g. add the custom card to the deck) **before**
   committing to combat/embark.

⚠️ **`validate` is structural, not live.** A pack can pass `validate` (clean clone)
and still fail at apply against real session state. Treat validate as "well-formed,"
not "will succeed here," and precheck at apply. (Tracked for tightening.)

Custom content resolves through the **session overlay** (`src/engine/content/view.ts`,
`withContentFor`). ⚠️ The overlay is **synchronous by design** — it is bound for the
*synchronous* portion of your handler only. Do NOT read catalogs after an `await`
inside a `withContentFor` callback; you'd see base content, not the session mods.
(The module is shared with the browser client engine, which has no
`AsyncLocalStorage`, so async-context propagation isn't available here. Keep
catalog reads in the synchronous prefix.)

---

## 8. Co-op (rooms, seats, the shared run)

Multiplayer is opt-in via your capabilities `multiplayer` block. The contract:

- A **room IS the active run**, addressed by `roomId`. Every coop tool call carries
  `mcp-session-id: <roomId>` so the host routes it to the same run DO as the human
  seats (without it the engine mints an orphan run per request).
- **Seats** identify who acts (`p1`/`p2`/…). Identity args (`by`, `seatId`,
  `playerId`) are corrected to the caller's seat by the host — don't trust a
  client-supplied seat to act as someone else.
- Room-scoped tools (`coop_*`: map draw/ping, propose/accept, intent) need
  `roomId` + `playerId` as **explicit** args — the engine does not infer them.
- Coordination signals (drawings, pings, telegraphs) go in a **side-journal**, not
  the reducer (rule §3). They're transient and never replayed.

Map drawing specifically: `coop_map_draw.events` is a **vector stroke array**
(`{type:"BeginLine"|"ContinueLine"|"EndLine"|"Point", position:{x,y}}`); `label` is
the player's name, not an emoji. There is no "emoji marker" — it's a freehand
whiteboard.

---

## 9. Mutation hygiene & host refresh

- **One mutation path:** every action goes through `dispatch(runId, action)` →
  pure reducer → `{state, events}` appended to the log. Never mutate `GameState`
  in place in a handler.
- After any mutating tool, the host refreshes panels. The `ui/notifications/tool-result`
  notification now carries **`affectedPanels: string[]`** — the panel URIs host-active
  for the resulting state — so a consumer can refresh only those instead of every open
  iframe. It's a scoping HINT (the `tool` field is unchanged for back-compat); a panel's
  own `tool-result` handler may check whether its URI is in the list before re-fetching
  `read_state`. Don't assume one cheap broadcast as your app grows.
- **Reads never mutate.** If a `read_state` changes state, you've created a
  Heisenbug for replay and coop.

---

## 10. A minimal panel skeleton

```ts
// my-panel/server.ts
export function createMyPanelServer(deps: PanelDeps): PanelServer {
  const URI = "ui://my-app/panel";
  const resource = {
    uri: URI, name: "My Panel", mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    _meta: { ui: { csp: EMPTY_CSP, permissions: {} },
             "io.sitebay.sorti": { layout: { slot: "main", title: "My Panel" } } },
  };
  const readState = {
    name: "my_panel.read_state",
    inputSchema: { type: "object", properties: {} },
    handler: () => computeMyViewModel(deps.getState(), deps),   // pure
  };
  const doThing = {
    name: "my_panel.do_thing",
    inputSchema: { type: "object", properties: { /* ... */ } },
    handler: (args) => deps.dispatch(deps.getState().runId, { kind: "do_thing", ...args }),
  };
  return {
    resource,
    tools: [readState, doThing],
    callTool: (name, args) => (name === readState.name ? readState.handler() : doThing.handler(args)),
    readResource: (uri) => (uri === URI ? { uri, mimeType: resource.mimeType, text: TEMPLATE_HTML, _meta: resource._meta } : null),
  };
}
```

---

## Checklist before you ship a panel

- [ ] Authoritative state in `GameState` only; lobby/draft on the session; transient in a journal (§3).
- [ ] `read_state` is pure and returns a self-contained, JSON-serializable VM (§4).
- [ ] All mutations go through `dispatch` → reducer; reads never mutate (§9).
- [ ] `_meta` declares least-privilege CSP and a layout slot (§6).
- [ ] Determinism: no `Date.now()`/`Math.random()` outside seeded RNG; no `Map`/`Set` in stored state.
- [ ] If modded: validate→apply ordering documented; catalog reads go through `withContentFor` (§7).
- [ ] If coop: room-scoped tools take explicit `roomId`/`playerId`; signals in a journal (§8).
- [ ] Template carries (or relies on the host to inject) the capture handler so the agent can see it (§5).
