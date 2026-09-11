# sorti-cartridge

**Sorti is the console; a cartridge is an app you own that plugs in.**

Forged apps live in the console — built and run by the Sorti platform, with
platform proofs gating every change. A cartridge is the app you BRING: full
TS/React client code (sandboxed by the host at mount time) and a self-hosted
server half on your own Cloudflare account. Sorti never runs your server
code — conformance is **advisory** (the host checks your wire shapes and
capabilities doc; a broken cartridge degrades, it doesn't get patched for
you). You get freedom; you own the pager.

This repo is the **starting template**: one chassis, multiple example apps.
The chassis (`src/`, `worker/`) is the panel-app machinery extracted from
the STS2 engine — the reference app behind `PANEL-AUTHORING.md`. The
examples (`examples/`) are two tiny, fully-wired apps you copy and gut:

| Example | Flavor | Proves |
|---|---|---|
| `examples/tally-duel/` | game | turn-ish actions, win conditions, agent seat, native RN panel |
| `examples/board/` | productivity / spatial | a document-per-run sticky-notes surface with client-side drag that commits ONE `move_note` on drop — canvas-LOOKING, but a guest panel, not the host canvas |

Both run through the SAME chassis: pure reducer → panel server → registry →
JSON-RPC MCP server → Worker + Durable Object.

> Building an app from this template with an agent? **`AGENTS.md`** is the
> map: what to copy, what to edit, what never to touch.

## What a cartridge exposes

1. **Tools** — reads (`board.read_state`, pure) and actions
   (`board.move_note`, reducer-backed) over JSON-RPC.
2. **`ui://` panel resources** — self-contained HTML documents the Sorti
   host mounts in a sandboxed iframe.
3. **A capabilities document** at `/.well-known/byo-mcp/capabilities.json`
   that tells the host what you offer.

The contract of record is [`PANEL-AUTHORING.md`](./PANEL-AUTHORING.md),
copied from the reference app — its `src/...` paths and STS2 examples refer
to that app; the mapping table below translates. Read it end-to-end once
before writing a panel.

**Verbatim with ONE deliberate exception**, and the exception is named here
rather than left for a re-sync to silently undo: the reference app's §6b
(*Client-side prediction (`clientEngine`)*) is replaced by this repo's
*Prediction — this cartridge does not predict*. A cartridge cannot predict,
so shipping the reference app's "how to declare one" section would be an
instruction that only ever produces a refusal. Re-sync every other byte
freely; that section is this repo's (see `RECUT.md`).

## 10-minute quickstart

```sh
bun install
bun test                 # reducers, panel contracts, MCP wire, worker, coop policies
bun run typecheck        # main + panels-rn configs
```

Make it your app:

1. Copy an example: `cp -r examples/board examples/<your-app>` (pick the
   example closest to your app's shape).
2. Edit `state.ts` + `reducer.ts` — your state, your actions. Keep the
   physics: `create*` deterministic, `reduce` pure, events out,
   replay-from-log reproduces state (the reducer tests show how; write
   yours first).
3. Edit `panel/server.ts` (URI, VM projector, tools) and
   `panel/template.html`, then `bun run build:templates`.
4. Register it in `examples/index.ts` (and delete the examples you don't
   want — remove their lines + directories).
5. `bun test` until green, then deploy (see [`DEPLOY.md`](./DEPLOY.md)):

```sh
bunx wrangler login
bun run deploy           # → https://sorti-cartridge.<you>.workers.dev
```

Point Sorti at the URL (add the MCP server in the host) and your panels
mount.

## Already have an app? Import it instead

The quickstart above CUTS a new app from an example. If you already have an
Expo / React Native app with a web export and an API, you do not start over:
`templates/import/` is a wrapper you copy into your own repo.

| | you bring | you get |
|---|---|---|
| **cut** | an idea | an example to mod (above) |
| **import** | an app with a web export and an API | a worker that serves the export as ONE panel (`ui://<slug>/app`) and your API as tools |

```sh
cp -r templates/import ./sorti      # in YOUR repo
mv sorti/sorti.import.json .        # name, slug, dist, apiBase, tools[]
npm run build:panel                 # your own web build
bun run sorti/worker/dev.ts         # the worker, on :8787
npm run conformance                 # the platform's bar, locally
```

One file describes the app (`sorti.import.json`) and the capabilities
document, the `/manifest` and the server card are all derived from it — three
documents that cannot drift because nobody types them twice. The export's
`index.html` is served with its asset URLs pointed at the worker and the
`window.SortiPanel` runtime injected, so the host's bridge reaches a page that
was never written for Sorti.

A tool proxies to your API with the CALLER's `Authorization` header, per call.
The worker keeps none — its env has one field, your asset store.

Read [`templates/import/IMPORT.md`](./templates/import/IMPORT.md): *Import your
Expo app in ten minutes*.

## Repo map

| Path | What it is |
|---|---|
| `AGENTS.md` | The modding map for agents (and humans in a hurry). |
| `PANEL-AUTHORING.md` | The contract of record (from the reference app; one section is ours — see above). |
| `RECUT.md` | The re-sync audit: every reference-app hunk since the cut, classified, with what was lifted. |
| `examples/` | The apps. `index.ts` is THE registration seam — everything an example exposes flows through it. |
| `examples/tally-duel/` | Game example: state, reducer, panel, coop policy, native RN panel. |
| `examples/board/` | Spatial example: sticky notes, drag-commit physics, tidy-bot coop policy. |
| `src/mcp/server.ts` | Chassis: JSON-RPC MCP server; binds each example its own dispatch/mint. |
| `src/mcp/example-contract.ts` | Chassis: the `CartridgeExample` interface examples implement. |
| `src/mcp/panels/registry.ts` | Chassis: panel aggregation, tool/URI uniqueness, routing. |
| `src/mcp/manifest.ts` | Chassis: `/manifest`, the BYO capabilities doc and the server card, all derived from the examples. |
| `src/mcp/alwaysLoad.ts` | Chassis: THE always-load declaration — the capabilities doc and the `tools/list` stamp both read it. |
| `src/coop/` | The `./coop` export: contract types + every example's coop domains. |
| `src/panels-rn/` | The `./panels-rn` export: registers examples' optional native renderers. |
| `worker/` | Self-host skeleton: Cloudflare Worker + one Durable Object persisting `{appId, state, log}` per session. |
| `vendor/` | Vendored contract shims (see the decisions log). |
| `tests/` | `bun test` suite — per-example reducer + panel suites, chassis wire, worker, coop. |
| `scripts/` | `build-templates` (html → .gen.ts). Output committed. |

Package exports mirror the reference app so a Sorti host consumes this
package the same way: `./panels-rn`, `./coop`, plus the `sorti.nativeEntry`
discovery field. There is deliberately no `./sorti-host` export and no
`sorti.hostEntry`: that is the HOST-BUILD lane, and a cartridge you deploy
yourself is never in the host's build graph — see "Prediction" in
`PANEL-AUTHORING.md`.

### PANEL-AUTHORING.md ↔ this repo

These are the seams a re-sync diffs. Last brought level with the reference
app at its commit `1ea37353` (2026-09-10) — see [`RECUT.md`](./RECUT.md) for
what was lifted and what was deliberately left.

| Doc reference (STS2) | Here |
|---|---|
| `src/mcp/panels/spec/registry.ts` | `src/mcp/panels/registry.ts` + `src/mcp/server.ts` |
| `src/mcp/panels/spec/combat/server.ts` (reference projector) | `examples/*/panel/server.ts` |
| `GameState` / the reducer | `examples/*/state.ts`, `examples/*/reducer.ts` |
| `src/mcp/manifest.ts` (capabilities + app manifest) | `src/mcp/manifest.ts` |
| `COOP_ALWAYS_LOAD_TOOLS` (the one always-load declaration) | `src/mcp/alwaysLoad.ts` |
| `src/coop/sts2-turn-policy.ts` (`Policy`, `attention`) | `examples/*/coop-policy.ts` |
| side-journals (`coop-intent-journal`, …) | not needed yet — add one only when you have transient signals (§3) |
| `window.SortiPanel` runtime | inlined in each `examples/*/panel/template.html` |

⚠️ The reference app's own iframe runtime now lives under
`src/mcp/panels/spec/_archive/` — its live panels are L3 React bundles, a lane
this repo deliberately has no dependency on. So that last row mirrors a
*contract* (the handshake and message shapes in `PANEL-AUTHORING.md` §5), not a
file to diff.

## Vendoring decisions log

The reference app depends on workspace packages that are not on npm. Every
substitution made to keep this repo self-contained:

- **`@sitebay/sorti-contract` → `vendor/sorti-contract/index.ts`.** A
  shape-faithful subset (MCP App resource types, `PanelServer` /
  `PanelToolDefinition` / `CallToolResult`, `createCallToolResult`, the
  native-panel + client-engine registries, the coop `Policy` seam, and the
  app self-description `SortiAppManifest` / `SORTI_APP_MANIFEST_URI`). When a
  published contract package exists, delete the directory and re-point imports.
  - Cut from contract **v1.0.0** type declarations, 2026-07-16.
  - **Re-synced to v1.1.0** on 2026-09-11 from
    the `@sitebay/sorti-contract` package at commit `77a5a11f8` (`coop.ts`,
    `ephemeralEvent.ts`, and `@sitebay/mcp-apps-contract`'s `panels.ts`, which
    that package re-exports). What came across: `CoopSeatRole`;
    `RoomSnapshot.baseSeq` and `.yieldPolicy`; `RoomOpDraft.group` and
    `.precondition`; `CoopPolicyDeps.playbook`; `EphemeralAnchor`,
    `PolicyAttention` and the optional `Policy.attention` hook;
    `SortiAppManifest`, `SortiAppQuickAction`, `SORTI_APP_MANIFEST_URI`.
    Still deliberately absent: everything the chassis does not consume
    (`CoopPeer`, the palettes, the guard functions, mission/workspace types).
- **`react-native` → `vendor/react-native-shim.d.ts` (types only).** Native
  panels typecheck against a minimal View/Text/Pressable/StyleSheet shim so
  `bun install` doesn't pull all of react-native; the real package is a peer
  dependency supplied by the host app at runtime.
- **No `@modelcontextprotocol/sdk`.** The MCP method surface a Sorti host
  needs (initialize, tools/list+call, resources/list+read) is ~150 lines of
  raw JSON-RPC in `src/mcp/server.ts`; the reference app does the same.
- **`wrangler` is not a devDependency.** Use `bunx wrangler ...` (or install
  globally) so `bun install` stays seconds, not minutes.
- **Panel runtime rewritten, not copied.** The reference app inlines a
  ~1,100-line runtime (prediction, coop presence, map drawing) into every
  template; the cartridge ships a ~150-line `window.SortiPanel` covering the
  wire contract (panel-ready/host-ready handshake, `tools/call` with
  `callId`, `tool-call/error`, `ui/notifications/tool-result` refresh,
  standalone fixtures). Grow it as your app needs to.
- **Durable Objects reduced to one class (`RunDO`)** persisting
  `{appId, state, log}` per session. The reference app keeps four (run,
  lobby, coop room, history); add classes the same hydrate/flush way as you
  grow.

## What was deliberately left out

STS2's engine (195 rule files), art/cinematic/autoslay/replay pipelines,
per-screen panel zoo (30 servers), mod-pack system, and coop rooms/SSE push.
Each has a marked seam where the reference app shows the full version.

**Client-side prediction is left out with no seam at all**, and that is a
correction rather than an omission: this repo shipped a prediction seam until
2026-08-19 and every part of it was decorative — measured, not argued, in
`PANEL-AUTHORING.md` under "Prediction". A seam a modder can trust is worse
than an absence they can read.
