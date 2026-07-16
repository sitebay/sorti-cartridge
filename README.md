# sorti-game-cookie

The **game-flavor starting repo for Sorti code apps** — think
"create-sorti-app, game flavor." It is the panel-app chassis extracted from
the STS2 engine (the reference app behind `PANEL-AUTHORING.md`), gutted of
game content and re-seeded with one tiny worked example: **Tally Duel**, a
two-seat race to a target score. Rename the duel, replace its reducer, and
you have your own game on the same wiring STS2 uses.

## What a code app is

A Sorti **code app** is an MCP server you host yourself that exposes:

1. **Tools** — reads (`duel.read_state`, pure) and actions (`duel.tap`,
   reducer-backed) over JSON-RPC.
2. **`ui://` panel resources** — self-contained HTML documents the Sorti host
   mounts in a sandboxed iframe.
3. **A capabilities document** at `/.well-known/byo-mcp/capabilities.json`
   that tells the host what you offer.

The contract of record is [`PANEL-AUTHORING.md`](./PANEL-AUTHORING.md)
(copied verbatim from the reference app — its `src/...` file paths and STS2
examples refer to that app; this cookie's equivalents are mapped below).
Read it end-to-end once before writing a panel.

**Code apps vs forged apps:** a forged app is built and run by the Sorti
platform, with platform proofs gating every change. A code app is yours:
full TS/React client code (sandboxed by the host at mount time) and a
self-hosted server half on your own Cloudflare account. Sorti never runs
your server code — conformance is **advisory** (the host checks your wire
shapes and capabilities doc; a broken app degrades, it doesn't get patched
for you). You get freedom; you own the pager.

## 10-minute quickstart

```sh
bun install
bun test                 # 39 tests: reducer, panel contract, MCP wire, worker, coop policy
bun run typecheck        # main + panels-rn configs
```

Rename the example into your game:

1. `src/game/state.ts` + `reducer.ts` — replace the duel state/actions with
   yours. Keep the shape: `createRun` deterministic, `reduce` pure, events
   out, replay-from-log must reproduce state (the reducer test shows how).
2. `src/mcp/panels/duel/` — copy to `src/mcp/panels/<yourpanel>/`, change the
   URI (`ui://<app>/<panel>`), the VM projector, and the tools. Edit
   `template.html`, then `bun run build:templates`.
3. `src/mcp/panels/registry.ts` — instantiate your panel in `entries`.
4. `src/mcp/server.ts` — adapt `new_run` and the instructions string.
5. `src/mcp/manifest.ts` — app id/name + `screenGroups`.
6. `bun test` until green, then deploy (see [`DEPLOY.md`](./DEPLOY.md)):

```sh
bunx wrangler login
bun run deploy           # → https://sorti-game-cookie.<you>.workers.dev
```

Point Sorti at the URL (add the MCP server in the host) and the duel board
mounts as a panel.

## Repo map

| Path | What it is |
|---|---|
| `PANEL-AUTHORING.md` | The contract of record (verbatim copy from the reference app). |
| `src/game/` | The example game: pure state + reducer. Replace this first. |
| `src/mcp/server.ts` | JSON-RPC MCP server (initialize / tools / resources). No SDK. |
| `src/mcp/panels/registry.ts` | Panel aggregator: injects `dispatch` once, routes tools/resources, enforces uniqueness. |
| `src/mcp/panels/duel/` | The worked-example PanelServer + iframe template (with the minimal `window.SortiPanel` runtime inlined). |
| `src/mcp/manifest.ts` | `/manifest` + BYO capabilities doc builders. |
| `src/client-engine/` | Optional client-side-prediction seam: reducer bundle URL + host registration (`sorti-host` export). |
| `src/coop/` | Optional agent-seat policy (`coop` export): deterministic duel heuristic implementing the contract `Policy`. |
| `src/panels-rn/` | Optional native RN renderer for the panel (`panels-rn` export). |
| `worker/` | Self-host skeleton: Cloudflare Worker + one Durable Object persisting the run between stateless requests. |
| `vendor/` | Vendored contract shims (see below). |
| `tests/` | `bun test` suite. |
| `scripts/` | `build-templates` (html → .gen.ts) and `build-client-engine` (reducer → browser bundle). Outputs are committed; run only after editing sources. |

Package exports mirror the reference app so a Sorti host can consume this
package the same way: `./panels-rn`, `./sorti-host`, `./client-engine`,
`./coop`, plus the `sorti.nativeEntry` / `sorti.hostEntry` discovery fields.

### PANEL-AUTHORING.md ↔ this repo

| Doc reference (STS2) | Here |
|---|---|
| `src/mcp/panels/spec/registry.ts` | `src/mcp/panels/registry.ts` |
| `src/mcp/panels/spec/combat/server.ts` (reference projector) | `src/mcp/panels/duel/server.ts` |
| `GameState` / the reducer | `src/game/state.ts`, `src/game/reducer.ts` |
| side-journals (`coop-intent-journal`, …) | not needed yet — add one only when you have transient signals (§3) |
| `window.SortiPanel` runtime | inlined in `src/mcp/panels/duel/template.html` |

## Vendoring decisions log

The source app depends on workspace packages that are not on npm. Every
substitution made to keep this repo self-contained:

- **`@sitebay/sorti-contract` → `vendor/sorti-contract/index.ts`.** A
  shape-faithful subset (MCP App resource types, `PanelServer` /
  `PanelToolDefinition` / `CallToolResult`, `createCallToolResult`, the
  native-panel + client-engine registries, and the coop `Policy` seam),
  copied from contract v1.0.0 type declarations. When a published contract
  package exists, delete the directory and re-point imports.
- **`react-native` → `vendor/react-native-shim.d.ts` (types only).** The
  native panel typechecks against a minimal View/Text/Pressable/StyleSheet
  shim so `bun install` doesn't pull all of react-native; the real package is
  a peer dependency supplied by the host app at runtime.
- **No `@modelcontextprotocol/sdk`.** The MCP method surface a Sorti host
  needs (initialize, tools/list+call, resources/list+read) is ~150 lines of
  raw JSON-RPC in `src/mcp/server.ts`; the reference app does the same.
- **`wrangler` is not a devDependency.** Use `bunx wrangler ...` (or install
  globally) so `bun install` stays seconds, not minutes.
- **Panel runtime rewritten, not copied.** The reference app inlines a
  ~1,100-line runtime (prediction, coop presence, map drawing) into every
  template; the cookie ships a ~150-line `window.SortiPanel` covering the
  wire contract (panel-ready/host-ready handshake, `tools/call` with
  `callId`, `tool-call/error`, `ui/notifications/tool-result` refresh,
  standalone fixtures). Grow it as your app needs to.
- **Durable Objects reduced to one class (`RunDO`)** persisting
  `{state, log}` per session. The reference app keeps four (run, lobby,
  coop room, history); add classes the same hydrate/flush way as you grow.

## What was deliberately left out

STS2's engine (195 rule files), art/cinematic/autoslay/replay pipelines,
per-screen panel zoo (30 servers), mod-pack system, coop rooms/SSE push, and
client-side prediction *implementation* (the seam is kept; the bundle is
served at `/engine.client.js`). Each has a marked seam where the reference
app shows the full version.
