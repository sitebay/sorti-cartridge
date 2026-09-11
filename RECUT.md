# RECUT.md — the chassis brought level with the reference app

**Date:** 2026-09-11 · **Slice:** S5a of Sorti's internal flagship plan
(2026-09-10) §2e.

This repo's chassis was cut out of the STS2 engine on **2026-08-19**. Since
then that engine changed every seam the chassis mirrors (the table in
`README.md`, *PANEL-AUTHORING.md ↔ this repo*). This file is the audit of that
drift: **every hunk**, classified, with the engine commit that made it and —
for the chassis ones — what it changed here.

- **Reference app:** the STS2 engine (Sorti's internal reference app, the one
  `PANEL-AUTHORING.md` was copied from), brought level with **`1ea3735345e67e4e17c2db2e8f80ddc96c6db4f0`** (2026-09-10 20:52 UTC).
- **Baselines** (the file as it stood when this repo was cut, i.e. the last
  commit touching it before 2026-08-20):
  `src/mcp/server.ts` + `src/engine/state.ts` → `9855843`;
  `src/mcp/panels/spec/registry.ts` → `0cdc01a`;
  `src/mcp/panels/spec/combat/server.ts` → `0d471cc`;
  `src/mcp/manifest.ts` → `10d2e41`; `PANEL-AUTHORING.md` → `f2db4c8`;
  `src/coop/*` → `4c985b0f~1`.

## The two classes, and the third column

**CHASSIS** = panel runtime, registry/routing, manifest + capabilities shape,
MCP server wire, coop contract types and seat/turn policy shapes,
refusal/idempotency/op-batching rules, native decoration rules, contract
fields. **GAME** = cards, relics, monsters, scenes, art, cinematic, autoslay,
replay, and the engine's own screens.

A hunk can be chassis-natured and still have **no counterpart here**; those say
so in the third column rather than being mislabelled GAME. Nothing is lifted
because it *could* be — an unused seam a modder can trust is worse than an
absence they can read.

| | hunks |
|---|---|
| **CHASSIS** | **25** — 13 lifted, 12 deliberately not (reason per row) |
| **GAME** | **52** |
| total | 77 |

---

## `src/mcp/server.ts` — baseline `9855843` (23 hunks)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `-1,3 +1,4` import `SORTI_META_NAMESPACE` | `1ea37353` | CHASSIS | **LIFTED** — `src/mcp/server.ts` imports it for the active-panel hint. |
| 2 | `-7,11 +8,12` import `COOP_ALWAYS_LOAD_SET`, `L3BundleLoader` | `9d02a1fe` / `bea04c5e` | CHASSIS | **LIFTED (half)** — the always-load import became `src/mcp/alwaysLoad.ts`. The L3 bundle loader has no counterpart: this repo has no `l3-bundle` lane, by design (`PANEL-AUTHORING.md` "Prediction"). |
| 3 | `-23,7 +25,9` import combat-event + map-ping journals | `7aea4263` / `340236dc` | GAME | transient combat/map signals. |
| 4 | `-41,6 +45,18` `McpServerOptions.loadPanelBundle` | `bea04c5e` | CHASSIS | **not lifted** — no bundle bytes to serve; the whole point of the option is keeping ~4.8 MB of bundles out of a Worker script this repo never has. |
| 5 | `-71,8 +87,40` `soloRepressPolicy` host override | `0eeb606a` | CHASSIS | **not lifted** — see row 19. |
| 6 | (same hunk) `SOLO_REPRESS_POLICY = "ask"` | `0eeb606a` → `cf8a60cc` | CHASSIS | **not lifted** — see row 19. |
| 7 | `-105,7 +153,9` journals instantiated | `7aea4263` / `340236dc` | GAME | |
| 8 | `-120,7 +170,9` journals onto `ToolContext` | `7aea4263` / `340236dc` | GAME | |
| 9 | `-132,14 +184,24` `isAlwaysLoadEntrypoint` reads the list instead of guessing | `9d02a1fe` | CHASSIS | **LIFTED** — `src/mcp/alwaysLoad.ts` is the one declaration; `server.ts` stamps `anthropic/alwaysLoad` from it and `manifest.ts` publishes the same names. |
| 10 | `-219,6 +281,24` `HOSTED_DISPLACED_SLOT` | `1ea37353` | GAME | the engine's session-autosave lane; this repo persists `{appId,state,log}` and offers no resume. |
| 11 | `-237,6 +317,12` displaced run steps sideways | `1ea37353` | GAME | |
| 12 | `-254,19 +340,42` `hostedResumeCandidate` | `1ea37353` | GAME | |
| 13 | `-286,6 +395,51` `withActivePanels` + the array guard | `1ea37353` | CHASSIS | **LIFTED** — `server.ts` `withActivePanels()`; every `tools/call` result now carries `_meta["io.sitebay.sorti"].activePanels`. The `typeof [] === "object"` guard came with it. |
| 14 | `-454,6 +608,7` `loadPanelBundle` into the registry | `bea04c5e` | CHASSIS | **not lifted** — row 4. |
| 15 | `-513,7 +668,9` journals into registry deps | `7aea4263` / `340236dc` | GAME | |
| 16 | `-526,9 +683,14` `listSaves` / companion deps | `1ea37353` | GAME | |
| 17 | `-547,20 +709,52` `startRun` takes `kickoffId` and `seed` | `0eeb606a` / `7927a667` | CHASSIS | **LIFTED** — `ExampleRuntimeDeps.mintRun(state, { kickoffId })`; both examples' mint tools take it. |
| 18 | `-580,9 +774,45` idempotency keys on the press, not on resemblance | `0eeb606a` | CHASSIS | **LIFTED** — the chassis holds `embarkKickoff = {kickoffId, runId}` and a repeat of the same press returns the live run untouched. |
| 19 | (same hunk) the `"ask"` refusal arm | `cf8a60cc` | CHASSIS | **not lifted, deliberately.** The owner's ruling was reasoned *from the length of a run* — "a machine may not throw away hours of a player's run without asking". A cartridge example's run is seconds long, and a chassis that refused every mint would be a worse default for a template than for a game. The half that is unambiguously chassis — a RETRY must never destroy a run — is row 18, and it is lifted. `MintOptions` documents the seam so an app can add the refusal. |
| 20 | `-599,6 +829,14` record which press minted this run | `0eeb606a` | CHASSIS | **LIFTED** — with row 18. |
| 21 | `-698,11 +936,15` dismiss/discard read the offered slot | `1ea37353` | GAME | row 10's lane. |
| 22 | `-766,7 +1008,7` legacy tool path decorated | `1ea37353` | CHASSIS | **LIFTED** — this repo has one tool path; it is decorated. |
| 23 | `-815,7 +1057,7` panel tool path decorated | `1ea37353` | CHASSIS | **LIFTED** — same path. |
| 24 | `-888,7 +1130,11` / `-912,8 +1158,13` `read(uri)` goes async, two-step | `bea04c5e` | CHASSIS | **not lifted** — the split exists because an L3 panel's bytes stopped being synchronously knowable. Here `getResourceContent` is a synchronous map lookup and `readResource` already exists beside it; going async would buy nothing and lose the 404/500 distinction the engine had to re-win. |

## `src/mcp/panels/spec/registry.ts` — baseline `0cdc01a` (18 hunks)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `-26,6` map-ping journal import | `340236dc` | GAME | |
| 2 | `-57,6` `SeatKind` import | `1ea37353` | GAME | |
| 3 | `-71,8` combat-event journal + `L3BundleLoader` imports | `7aea4263` / `bea04c5e` | CHASSIS/GAME | neither applies — see server rows 3 and 4. |
| 4 | `-163,7` `startRun` gains `kickoffId` + `seed` | `0eeb606a` / `7927a667` | CHASSIS | **LIFTED** — server row 17 (this is the same seam seen from the registry). |
| 5 | `-196,10` `loadPanelBundle`, `combatEventJournal`, `mapPingJournal` deps | `bea04c5e` / `340236dc` | CHASSIS/GAME | not applicable — server rows 4 and 3. |
| 6 | `-218,7` the "~30 tools" comment was off by 4x | `7927a667` | GAME | a count of that app's own surface. |
| 7 | `-247,16` / `-277,38` combat tails move into the journal | `7aea4263` | GAME | **The chassis lesson was read and left as prose**, not code: per-request tails are invisible to every other coop seat, so a transient signal needs a journal the transport hydrates. `README.md` already says "add one only when you have transient signals"; this repo still has none. |
| 8 | `-357,30` map erase / pings / `mapKey` staleness | `340236dc` / `1ea37353` | GAME | |
| 9 | `-389,8` / `-398,10` / `-423,6` draw-stroke + reward rows | `340236dc` / `9d02a1fe` | GAME | |
| 10 | `-447,14` rest `targetId` | `9d02a1fe` | GAME | |
| 11 | `-485,18` `game_over.restart` stops dropping coop | `1ea37353` | GAME | that app's lobby. |
| 12 | `-504,7` / `-560,7` viewer-scoped combat log | `1ea37353` | GAME | |
| 13 | `-536,6` `listSaves` on the lobby | `1ea37353` | GAME | ⚠️ **this hunk ships the same `...(deps.listSaves ? …)` spread TWICE in one object literal** (`registry.ts:643` and `:651` at HEAD). Harmless — the second wins with the same value — but it is a real duplicate in the reference app, not a transcription error here. |
| 14 | `-582,27` 21 L3 servers take the loader | `bea04c5e` | CHASSIS | **not lifted** — server row 4. |

## `src/mcp/manifest.ts` — baseline `10d2e41` (6 hunks)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `-1,4` import `SortiAppManifest` | `9d02a1fe` | CHASSIS | **LIFTED** — into the vendored shim and `manifest.ts`. |
| 2 | `-16,6` `COOP_ALWAYS_LOAD_TOOLS` extracted as THE declaration | `9d02a1fe` | CHASSIS | **LIFTED** — `src/mcp/alwaysLoad.ts`. The engine's *names* are game content; the law ("it is an array because there must be one") is the lift. |
| 3 | `-29,6` no `loadPanelBundle` in the Worker's graph | `bea04c5e` | CHASSIS | **not lifted** — server row 4. |
| 4 | `-119,6` `ByoCapabilities.manifest?: SortiAppManifest` | `9d02a1fe` | CHASSIS | **LIFTED** — `ByoCapabilities.manifest`, built from the examples, so activation costs no second fetch. |
| 5 | `-296,6` the manifest body + `quickActions` | `9d02a1fe` | CHASSIS/GAME | **LIFTED (the shape)** — `CartridgeExample.quickActions`, with tally-duel declaring one (`guardLiveRun` + both prompts) and board declaring none. sts2's two actions are that app's content. |
| 6 | `-306,29` `alwaysLoadTools: [...COOP_ALWAYS_LOAD_TOOLS]` | `9d02a1fe` | CHASSIS | **LIFTED** — `coop.alwaysLoadTools` on the capabilities doc, from the same module the stamp reads. |

## `src/mcp/panels/spec/combat/server.ts` — baseline `0d471cc` (3 hunks)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `-108,7` `getLogTail(viewerId)` — second person for your own seat | `7aea4263` | GAME | a combat log. |
| 2 | `-269,18` the self-filter keys on the RESOLVED viewer | `1ea37353` | GAME | |
| 3 | `-316,6` `needsTarget` / `commit` / `chase` / `playZone` declared "presentation-only; ignored" | `9d02a1fe` | CHASSIS | **not lifted** — the rule (a tool must accept-and-ignore the host's drag declarations or a host drop is refused) has no target here: the board's drag is panel-local, it declares `drag: {sources: [], targets: []}`, and the host sends no such keys. It becomes live the day an example declares a host drag source. |

## `src/coop/*` — baseline `4c985b0f~1` (5 hunks)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `agent-policy.ts -1,7` plan path moved to `archive/` | `7927a667` | GAME | a doc pointer in that repo. |
| 2 | `seat-wait-policy.ts +1,140` (new) declared seat-wait policies | `b065ffda` → `a0931107` | CHASSIS | **not lifted** — `SeatWaitDeclaration` / `DecisionPolicy` come from `@sitebay/collab-room`, which this repo has no dependency on and which is not re-exported by `sorti-contract`; and a declaration is "this gate is holding the table", which needs per-seat gates no example has. Vendoring a type to declare nothing would be a decorative seam. |
| 3 | `sts2-turn-policy.ts -9,6` import `PolicyAttention` | `4c985b0f` | CHASSIS | **LIFTED** — into the shim. |
| 4 | `sts2-turn-policy.ts -758,6` the `attention()` hook | `4c985b0f` | CHASSIS | **LIFTED** — `Policy.attention?()` in the shim, implemented by both example policies (duel → the scoring seat; board → the note about to move). |
| 5 | `sts2-turn-policy.ts -1260,20` `decideReward` takes every claimable row | `9d02a1fe` | GAME | that app's reward screen. |

## `src/engine/state.ts` — baseline `9855843` (21 hunks)

Mirror-table row: *`GameState` / the reducer → `examples/*/state.ts`,
`examples/*/reducer.ts`*. **19 of 21 are GAME**: relic animations, rest
options, map point history, `MAX_HAND_SIZE`, generated-card doors, new
`Action` and `EngineEventKind` members, `CombatPileKind`,
`CardPileTriggerEvent`, `HandFlushedEvent`, source animations, and the
`cardDrawOnce:` turn-flag sweep (`GENERATED_TURN_LOCAL_FLAG_PREFIXES`,
`1ccc6742`/`b998ebfa`/`9d02a1fe`).

The other two are chassis-natured:

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 20 | `-2323,0 +2422,21` `cloneExotic` | `9d02a1fe` | CHASSIS | **not lifted** — it exists because `structuredClone` is absent in the host's QuickJS prediction sandbox. This repo's chassis clones inside a Cloudflare Worker, where it exists, and a cartridge has no prediction sandbox to run in. Its state contract also forbids the shapes the fallback is for (`AGENTS.md`: no `Date`/`Map`/`Set` in state). Revisit the day a cartridge reducer runs client-side. |
| 21 | `-2333 +2452` `clonePlain` calls it | `9d02a1fe` | CHASSIS | same. |

## `PANEL-AUTHORING.md` — baseline `f2db4c8` (1 hunk)

| # | hunk | commit | class | what it changes here |
|---|---|---|---|---|
| 1 | `-206,9 +206,32` the dev twin re-breaks engine parity on every rebuild | `7927a667` | CHASSIS | **not lifted, and it cannot be.** The whole hunk lands inside §6b, *Client-side prediction (`clientEngine`)* — the one section this repo deliberately replaces with *Prediction — this cartridge does not predict* (commit `5f73a53`, and `tests/prediction-seam.test.ts` is its gate). Re-copying it verbatim would hand a modder a "how to declare a clientEngine" instruction that can only ever produce the host's refusal. **Verified:** outside that section and the ship-checklist line it adds, this repo's copy is already byte-identical to `1ea37353`. |

---

## Facts for the ledger

1. **`PANEL-AUTHORING.md` is not verbatim, and the README said it was.** It has
   not been since 2026-08-19. `README.md` now names the one exception at the
   claim instead of leaving a re-sync to silently undo it.
2. **The `window.SortiPanel` mirror row points at an archive.** The reference
   app's iframe runtime lives only under `src/mcp/panels/spec/_archive/` (moved
   there `0421848e`, 2026-07-28) and has not changed since this repo was cut —
   its live panels are L3 React bundles. That row mirrors a *contract*
   (`PANEL-AUTHORING.md` §5's handshake and message shapes), not a file to
   diff. `README.md` now says so.
3. **Two line references inside the copied contract are stale in the reference
   app itself.** `PANEL-AUTHORING.md:61` cites `spec/registry.ts:175` (now a
   `/**`) and `:115` cites `spec/combat/server.ts:378` (now an unrelated
   branch). Carried as-is: the file is a verbatim copy, and fixing the numbers
   here would fork it for a defect that belongs upstream.
4. **A duplicate in the reference app.** `spec/registry.ts` spreads
   `...(deps.listSaves ? { listSaves: deps.listSaves } : {})` twice into one
   object literal (HEAD `:643` and `:651`). Harmless, real, upstream.
5. **The contract package moved v1.0.0 → v1.1.0** and `SortiAppManifest` is
   *not* in `sorti-contract/src` — it lives in `@sitebay/mcp-apps-contract`
   (`src/panels.ts:602`), which `sorti-contract/src/index.ts:28` re-exports.
   A re-sync that greps only `sorti-contract/src` will not find it.
6. **The always-load defect is structural, not sts2's.** Any server that
   publishes `coop.alwaysLoadTools` AND stamps `anthropic/alwaysLoad` has two
   places to say one thing. `src/mcp/alwaysLoad.ts` makes them one function
   over one surface, and `tests/manifest.test.ts` pins both directions —
   because the engine's version of this bug survived months of a host carrying
   a hand-copy that hid it.
