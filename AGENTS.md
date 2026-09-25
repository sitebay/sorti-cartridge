# AGENTS.md — modding map for sorti-cartridge

You were probably told: "make me an app from this template." This file is
the map. The deep contract is `PANEL-AUTHORING.md` (read it once, end to
end); the trust model in one line: **conformance is advisory and the host
sandboxes your panel** — nothing platform-side runs or fixes your server.

## First-class ordinary apps

Read `examples/sitebaywp-reference/README.md` before choosing a game-shaped starter for a business app. Its generated source capsule unpacks to a self-contained public-SDK app with its own AGENTS, descriptor and tests. The five-file recipe below remains for the existing cartridge examples; do not force the single-source reference into that shape or edit the chassis to accommodate it.

## The shape

```
sorti-cartridge/
├── examples/               ← THE APPS. This is where you work.
│   ├── index.ts            ← registration seam: every app mounts through this file
│   ├── tally-duel/         ← game-flavor example (state, reducer, panel, coop, RN panel)
│   └── board/              ← spatial/productivity example (sticky notes, drag-commit)
├── src/                    ← CHASSIS. Do not edit to add an app.
│   ├── mcp/server.ts       ← JSON-RPC MCP server; binds each app its dispatch/mint
│   ├── mcp/example-contract.ts ← the CartridgeExample interface apps implement
│   ├── mcp/panels/registry.ts  ← panel aggregation + tool/URI uniqueness
│   ├── mcp/manifest.ts     ← /manifest + BYO capabilities doc + server card (derived from examples)
│   ├── mcp/alwaysLoad.ts   ← THE always-load declaration; doc + tools/list stamp read it
│   ├── coop/               ← ./coop export barrel (re-exports examples' domains)
│   └── panels-rn/          ← ./panels-rn export barrel (optional native renderers)
├── worker/                 ← self-host skeleton: CF Worker + RunDO (hydrate/flush)
├── vendor/                 ← shims for unpublished workspace packages
├── scripts/                ← build-templates (html → .gen.ts; output committed)
├── tests/                  ← bun test; per-example suites + chassis wire tests
│                             EXTENDING an example? add `tests/<example>-<feature>.test.ts`
│                             and leave the example's existing suite byte-identical, so a
│                             reviewer can see the new behaviour without re-reading the old
├── PANEL-AUTHORING.md      ← the contract of record
└── DEPLOY.md               ← wrangler login → deploy → point Sorti at the URL
```

## What to MOD (the recipe)

1. `cp -r examples/board examples/<your-app>` (or tally-duel — pick the
   closer shape). Rename identifiers, pick a tool prefix (`<app>.*`) and a
   panel URI (`ui://<app>/<panel>` — the URI's first segment MUST equal the
   tool prefix; the panel runtime derives `<app>.read_state` from it).
2. Write tests for your reducer FIRST (copy `tests/board-reducer.test.ts`),
   then edit `state.ts` + `reducer.ts`. Non-negotiable physics: `create*`
   deterministic, `reduce` pure (clone, never mutate; throw on illegal),
   no `Date.now()`/`Math.random()`/`Map`/`Set` in state, replaying the
   action log reproduces the state.
3. Edit `panel/server.ts`: the VM projector (pure, self-contained JSON) and
   tools — `<app>.read_state`, a mint tool, and your actions, all mutating
   only through the injected `dispatch`.
4. Edit `panel/template.html` (keep the inlined `window.SortiPanel` runtime
   block untouched), then run `bun run build:templates`.
   Your mint tool takes `kickoffId`: one id per PRESS, minted by the client.
   Re-sending the same id RESUMES the run it started; a different id mints a
   fresh one. Never key this on the request RESEMBLING a live run — that
   cannot tell "my partner already started this, join it" from "I want a new
   one with the same settings", and the reference app spent a week returning
   one run and one seed to three consecutive presses because of it.
5. Register in `examples/index.ts` (EXAMPLES + COOP_DOMAINS). Delete
   example dirs you don't want and their lines there (plus the tally-duel
   lines in `src/panels-rn/index.ts` if you delete it).
   In your `CartridgeExample`, also declare:
   - `alwaysLoadTools` — the ACTION verbs an agent must be able to FIND on
     turn one. `<app>.read_state` arrives by pattern; do not list it. This is
     ONE declaration: `src/mcp/alwaysLoad.ts` feeds both the capabilities
     doc's `coop.alwaysLoadTools` and the `anthropic/alwaysLoad` stamp on
     `tools/list`, and `tests/manifest.test.ts` pins them to each other in
     both directions.
   - `probeTools` — the tools the platform's conformance bar may CALL on your
     DEPLOYED app while it proves your listing: no arguments, no side effect,
     so a read or a peek and never a mint. `src/mcp/manifest.ts` publishes
     them as the capabilities doc's `conformance.probeTools`. Omitting it is
     legal (the bar then derives from your schemas) but declaring it is how
     you decide what gets called.
   - `quickActions` (optional) — launcher buttons beside your app's tile. A
     button whose tool DISCARDS work in progress must set `guardLiveRun` and
     carry both `agentPrompt` and `resumePrompt`; without `agentPrompt` the
     call is invisible to the agent, which then reports "nothing loaded yet"
     at a table that just started.
   - `Policy.attention` in your `coop-policy.ts` (optional) — where your seat
     is looking, for the ephemeral halo lane. Pure, synchronous, null when
     the op has no visible target. Both fields are YOUR vocabulary; a driver
     that guessed them would be inventing ids on your behalf.
6. Optionally rebrand: `CARTRIDGE_ID`/`CARTRIDGE_DISPLAY_NAME` in
   `src/mcp/manifest.ts`, names in `package.json` / `worker/wrangler.toml`.
7. `bun test && bun run typecheck`, then follow `DEPLOY.md`.

⛔ **Do not add a client-side prediction seam.** A cartridge cannot
predict today — not "has not yet", cannot: the host resolves a panel's
engine declaration only for `panelKind: "l3-bundle"` panels, and those
need three unpublished workspace packages this repo deliberately does not
depend on. PANEL-AUTHORING.md "Prediction" carries the four measurements
and the preconditions; `tests/prediction-seam.test.ts` fails the day a
declaration reappears without a bundle that survives the host's loader.

Files a new app touches — everything else is chassis:

```
examples/<your-app>/state.ts            (new)
examples/<your-app>/reducer.ts          (new)
examples/<your-app>/panel/server.ts     (new)
examples/<your-app>/panel/template.html (new; template.gen.ts is generated)
examples/<your-app>/index.ts            (new; coop-policy.ts optional)
examples/index.ts                       (edit: register)
tests/<your-app>-*.test.ts              (new; mirror an example's suite)
```

## What NOT to touch

- **`src/mcp/*`, `worker/*`** — the wire contract lives here (JSON-RPC
  method surface, resource shapes, hydrate/flush, CORS, room identity —
  `params._meta["io.sitebay.sorti/roomId"]` per MCP 2026-07-28, with the
  `mcp-session-id` header as a deprecated fallback that is still echoed;
  the authority is `sorti-contract/src/mcpSessionMeta.ts`).
  Hosts are data-driven against these exact shapes; "improving" them breaks
  mounting silently. Extend by adding an example, not by editing the chassis.
- **The panel-ready/host-ready handshake** (the `window.SortiPanel` script
  block inside each template, and its message shapes: `tools/call`+`callId`,
  `tool-call/error`, `ui/notifications/tool-result`). Copy it verbatim into
  new templates.
- **`vendor/`** — shape-faithful shims for unpublished contract packages,
  frozen against contract **v1.1.0** (re-synced 2026-09-11). Never extend
  locally: a field the real package does not have is a field no host reads.
  Re-sync by copying from the package, never by inventing; when a published
  `@sitebay/sorti-contract` exists, delete the shim and re-point imports
  (dates, source commit and the copied symbol list are in README's vendoring
  log).

## Contract pointers

- `PANEL-AUTHORING.md` — state ownership (§3), pure VMs (§4), `_meta`/CSP
  (§6), mutation hygiene (§9), the ship checklist.
- Capabilities caps (`src/mcp/manifest.ts` + `tests/manifest.test.ts`
  enforce): every tool claimed by exactly one module, ≤20 tools/module,
  specialists ≤12 tools each, panels/screenGroups only reference declared
  URIs.
- Trust: the host mounts your panel in a sandboxed iframe with
  least-privilege CSP; your server is self-hosted; conformance failures
  degrade your app rather than block your deploy.

## Guided authoring entry

`package.json#sorti.authoring` is the executable mode, entrypoint and command map.
Forge derives its workbench from these script references; absent scripts are setup failures, not a request to create a replacement panel.
