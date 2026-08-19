/**
 * THE PREDICTION GATE — fails if the prediction seam goes decorative again.
 *
 * ── What went wrong, and why a test did not catch it ─────────────────────────
 *
 * Until 2026-08-19 this repo shipped a client-side prediction seam: a
 * `src/client-engine/` directory, a `/engine.client.js` worker route, a
 * `./sorti-host` package export, and DEPLOY.md step 1 telling you to paste your
 * deployed URL into it so "panels load the reducer bundle". None of it worked.
 * Four measurements, all reproducible and all in PANEL-AUTHORING.md
 * "Prediction": the documented `engineId` lane is a HOST-BUILD registry a
 * deployed cartridge is never in; the served bundle was an ES module, which is
 * a `SyntaxError` under the host's classic-script loader, and exported raw
 * reducers rather than the five verbs the host calls; `ENGINE_VERSION` was a
 * hand-typed literal behind an `immutable` one-year cache, so changed bytes
 * still passed the sandbox's version-parity check; and no panel declared the
 * seam at all, nor could one — the host resolves an engine declaration only for
 * `panelKind: "l3-bundle"` panels.
 *
 * The suite was green throughout. The one test that touched the seam asserted
 * that the served BYTES contained the string `"REDUCERS"`. That is the bug this
 * file exists to prevent: **an existence check blesses a mechanism that has
 * never run.** So nothing here greps for a seam. The checker below evaluates a
 * bundle exactly the way the host does — classic script, fresh realm, read
 * `globalThis.__sortiClientEngine` — and then makes it predict a real action
 * and compares the answer with the authority's own projector.
 *
 * ── The two halves ───────────────────────────────────────────────────────────
 *
 * 1. THE CENSUS (self-arming). Asks the real MCP server what every panel
 *    declares. A `clientEngine` declaration must be backed: the `engineId` arm
 *    fails outright (it cannot resolve for a BYO cartridge), and the
 *    `{ url, version }` arm must name an `l3-bundle` panel, must be served by
 *    this worker, must pass the checker, and must have a fixture here to be
 *    driven with. The census also fails on the inverse shape — machinery with
 *    no panel using it — which is exactly what was here before.
 *
 * 2. THE CONTROLS (never vacuous). Five bundles are put through the checker on
 *    every run: the ESM bundle this repo actually served, a verbs-short bundle,
 *    a version-skewed bundle, a bundle that predicts a WRONG view-model, and
 *    one built the real way over tally-duel's own reducer and projector. Four
 *    must be rejected and one accepted. If the checker ever stops being able to
 *    tell them apart, these go red before any claim is made.
 *
 * ── Falsified, not asserted ──────────────────────────────────────────────────
 *
 * Run against the tree as it stood before this file existed (`git archive HEAD`
 * of 58d03b8 + this test), the census goes RED and names every offender:
 * `src/client-engine/sorti-host.ts: registers a client engine; … worker/index.ts:
 * serves an engine bundle route; scripts/build-client-engine.mjs: …`. Then five
 * re-introductions were staged one at a time — an `engineId` declaration; a BYO
 * `{ url, version }` on an HTML panel; the same on an `l3-bundle` panel with no
 * fixture; the whole original bug (panel + fixture + worker serving the old ESM
 * bundle, which fails with `SyntaxError: Unexpected keyword 'export'`) — and
 * each one reddens. A genuinely REAL seam (worker serving an IIFE built from
 * this file's recipe, declared by an l3-bundle panel, fixture supplied) passes
 * all ten: the gate demands proof, it does not forbid the fix.
 *
 * Each control was falsified by deleting its rule from the checker — the
 * classic-script load, the version-parity compare, the verb census, the
 * authority compare, the refusal check — and in every case the arm that should
 * have caught the bad bundle went red instead.
 */

import { describe, expect, test } from "bun:test";
import vm from "node:vm";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../worker/index.ts";
import { createMcpServer } from "../src/mcp/server.ts";
import { SORTI_META_NAMESPACE } from "../vendor/sorti-contract/index.ts";
import { createRun } from "../examples/tally-duel/state.ts";
import { reduce } from "../examples/tally-duel/reducer.ts";
import { computeDuelViewModel } from "../examples/tally-duel/panel/server.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── the checker ──────────────────────────────────────────────────────────────

/** One (state, intent, expected view-model) triple the checker drives a bundle with. */
type PredictionFixture = {
  /** The engine state the host would hand the sandbox (`engineState`). */
  state: unknown;
  /** A panel app-intent the bundle MUST predict. */
  intent: unknown;
  /** `ClientEngineBuildVmOptions` + acting seat. `stateTool` says which panel asked. */
  opts: { stateTool?: string; participant?: string | null; playerId?: string | null };
  /** What the AUTHORITY's own projector returns for the post-action state. */
  authorityVm: unknown;
  /** An intent the app cannot predict; the bundle must answer `{ ok: false }`. */
  unpredictableIntent: unknown;
};

type CheckResult = { ok: true } | { ok: false; reason: string };

/** Order-independent structural compare, so key order is not the thing that fails. */
function canonical(value: unknown): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };
  return JSON.stringify(walk(value));
}

/**
 * Evaluate a bundle the way the host's sandbox harness does — as a CLASSIC
 * script in a fresh realm — then apply the harness's own readiness predicate
 * verbatim: `engine && typeof engine.reduce === 'function' && typeof
 * engine.version === 'string'`.
 *
 * Classic, not module, is the whole first count: an ESM bundle cannot execute
 * under `<script src>` / `eval`, so it never registers anything.
 */
function loadAsHostWould(source: string): CheckResult & { engine?: Record<string, unknown> } {
  // The realm the host evaluates in is a browser one (a sandboxed iframe on
  // web, a WebView on native), so `structuredClone` is there. A bare `node:vm`
  // context has neither it nor `console`, and this repo's own state doctrine
  // (`cloneState` = `structuredClone`) means a cartridge reducer needs the
  // first. Provisioning exactly these two keeps the checker faithful instead of
  // failing every honest bundle for the realm's sake.
  const sandbox: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
    structuredClone,
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(source, sandbox, { filename: "engine.client.js" });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, reason: `bundle failed to evaluate as a classic script: ${message}` };
  }
  const engine = sandbox.__sortiClientEngine as Record<string, unknown> | undefined;
  if (!engine || typeof engine.reduce !== "function" || typeof engine.version !== "string") {
    return { ok: false, reason: "engine bundle did not expose __sortiClientEngine { version, reduce }" };
  }
  return { ok: true, engine };
}

/**
 * The full contract, driven. A bundle passes only if it loads, agrees on its
 * version, exposes every verb the host calls, predicts the fixture intent, and
 * produces the view-model the AUTHORITY produces for the same action. The last
 * clause is the one an existence check can never have: a seam that answers
 * confidently with the wrong frame is worse than one that refuses.
 */
function checkClientEngineBundle(input: {
  source: string;
  declaredVersion: string;
  fixture: PredictionFixture;
}): CheckResult {
  const loaded = loadAsHostWould(input.source);
  if (!loaded.ok) return loaded;
  const engine = loaded.engine as Record<string, (...args: unknown[]) => unknown> & { version: string };

  if (engine.version !== input.declaredVersion) {
    return {
      ok: false,
      reason:
        `engine version parity failed: declaration says ${input.declaredVersion}, ` +
        `bundle reports ${String(engine.version)}`,
    };
  }
  for (const verb of ["buildVm", "intentToAction", "predictIntent"] as const) {
    if (typeof engine[verb] !== "function") {
      return { ok: false, reason: `bundle exposes no \`${verb}\` — the host calls all five verbs` };
    }
  }

  // Narrowed AFTER the verb loop proved it is callable; the index signature
  // alone cannot know that.
  const predictIntent = engine.predictIntent as (...args: unknown[]) => unknown;

  const { state, intent, opts, authorityVm, unpredictableIntent } = input.fixture;
  let predicted: unknown;
  try {
    predicted = predictIntent(structuredClone(state), intent, opts);
  } catch (error) {
    return { ok: false, reason: `predictIntent threw instead of refusing: ${String(error)}` };
  }
  const result = predicted as { ok?: unknown; vm?: unknown } | null | undefined;
  if (!result || result.ok !== true) {
    return {
      ok: false,
      reason: "predictIntent refused the fixture intent — a bundle that cannot predict its own worked example predicts nothing",
    };
  }
  if (canonical(result.vm) !== canonical(authorityVm)) {
    return {
      ok: false,
      reason:
        "predicted view-model disagrees with the authority's own projector — " +
        `predicted ${canonical(result.vm)}, authority ${canonical(authorityVm)}`,
    };
  }

  let refusal: unknown;
  try {
    refusal = predictIntent(structuredClone(state), unpredictableIntent, opts);
  } catch (error) {
    return { ok: false, reason: `predictIntent threw on an unpredictable intent: ${String(error)}` };
  }
  if ((refusal as { ok?: unknown } | null)?.ok === true) {
    return {
      ok: false,
      reason: "predictIntent answered an intent it cannot know — refusing is free, guessing is the failure",
    };
  }
  return { ok: true };
}

// ── the fixtures ─────────────────────────────────────────────────────────────

const DUEL_STATE = createRun({ runId: "gate-run", seed: 1 });
const DUEL_INTENT = { type: "duel.tap", playerId: "p1" };

const DUEL_FIXTURE: PredictionFixture = {
  state: DUEL_STATE,
  intent: DUEL_INTENT,
  opts: { stateTool: "duel.read_state", participant: "p1", playerId: "p1" },
  // THE AUTHORITY, called here exactly as `duel.tap`'s handler calls it.
  authorityVm: computeDuelViewModel(reduce(DUEL_STATE, { kind: "tap", playerId: "p1" }).state),
  unpredictableIntent: { type: "duel.inspect_history" },
};

/**
 * A declaring panel needs one of these. Empty on purpose: no cartridge panel
 * declares a client engine, and the census below fails loudly if one starts to
 * without adding its triple here. That demand IS the proof-of-life rule — a
 * claim you cannot drive end to end is the claim this file exists to stop.
 */
const PREDICTION_FIXTURES: Record<string, PredictionFixture> = {};

// ── the worked recipe (the positive control) ─────────────────────────────────

/**
 * The bundle a cartridge WOULD ship, built from tally-duel's real reducer and
 * real projector. It is compiled as an IIFE (what the host's `<script src>`
 * loader can execute) and composes the five verbs by hand — the shape
 * `@sitebay/forge-reducer-dsl`'s `createClientEngine` produces, written out
 * because this repo depends on no monorepo package.
 *
 * Two details are the doctrine, not decoration:
 *   - `intentToAction` returns `null` for anything it does not own, and
 *   - `buildVm` THROWS for a `stateTool` it has no projector for,
 * so `predictIntent` answers `{ ok: false }` rather than handing some other
 * panel a duel view-model. Refusing costs a prediction; guessing costs a frame
 * that the server never confirms.
 */
const RECIPE_ENTRY = `
import { reduce } from ${JSON.stringify(join(REPO_ROOT, "examples/tally-duel/reducer.ts"))};
import { computeDuelViewModel } from ${JSON.stringify(join(REPO_ROOT, "examples/tally-duel/panel/server.ts"))};

const VERSION = "__VERSION__";

const PROJECTORS = { "duel.read_state": (state) => computeDuelViewModel(state) };

function intentToAction(intent, ctx) {
  const seat = (ctx && ctx.playerId) || (intent && intent.playerId) || null;
  if (!intent || !seat) return null;
  if (intent.type === "duel.tap") return { kind: "tap", playerId: seat };
  if (intent.type === "duel.boost") return { kind: "boost", playerId: seat };
  return null;
}

function buildVm(state, opts) {
  const tool = opts && opts.stateTool;
  const projector = tool && Object.prototype.hasOwnProperty.call(PROJECTORS, tool) ? PROJECTORS[tool] : null;
  if (!projector) throw new Error("no projector for stateTool " + String(tool));
  return projector(state);
}

const api = {
  version: VERSION,
  reduce: (state, action) => reduce(state, action).state,
  buildVm,
  intentToAction,
  predictIntent(state, intent, opts) {
    const action = intentToAction(intent, { playerId: (opts && (opts.playerId || opts.participant)) || null });
    if (!action) return { ok: false };
    try {
      const next = api.reduce(state, action);
      return { ok: true, state: next, vm: buildVm(next, opts || {}) };
    } catch {
      return { ok: false };
    }
  },
};

globalThis.__sortiClientEngine = api;
`;

let recipeCache: string | null = null;

/**
 * Build the recipe as an IIFE. Variants are made by editing the ENTRY before
 * the bundler runs, never by string-patching the built output: a needle that
 * silently fails to match built bytes turns a negative control into a second
 * copy of the positive one, which is a green test that proves nothing. Each
 * mutation asserts it changed something.
 */
async function buildRecipeBundle(opts?: { version?: string; mutate?: (entry: string) => string }): Promise<string> {
  const version = opts?.version ?? "1.0.0";
  const pristine = version === "1.0.0" && !opts?.mutate;
  if (pristine && recipeCache) return recipeCache;
  let entrySource = RECIPE_ENTRY.replace("__VERSION__", version);
  if (opts?.mutate) {
    const mutated = opts.mutate(entrySource);
    if (mutated === entrySource) throw new Error("recipe mutation did not change the entry — the control is inert");
    entrySource = mutated;
  }
  const dir = mkdtempSync(join(tmpdir(), "cartridge-engine-"));
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, entrySource);
  const built = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: false });
  if (!built.success) throw new Error(`recipe bundle failed to build: ${built.logs.join("\n")}`);
  const source = await built.outputs[0]!.text();
  if (pristine) recipeCache = source;
  return source;
}

/** The exact bundle `scripts/build-client-engine.mjs` used to emit (ESM, raw reducers). */
const DECORATIVE_ESM_BUNDLE = `
// examples/tally-duel/reducer.ts
function reduce(state, action) { return { state, events: [] }; }
var ENGINE_VERSION = "0.1.0";
var REDUCERS = { "tally-duel": reduce };
export { REDUCERS, ENGINE_VERSION };
`;

// ── the census ───────────────────────────────────────────────────────────────

type PanelClaim = {
  uri: string;
  panelKind: unknown;
  clientEngine: { engineId?: unknown; url?: unknown; version?: unknown };
};

/** Ask the REAL server what every panel declares (semantic, not a grep). */
function collectPanelClaims(): PanelClaim[] {
  const server = createMcpServer();
  const claims: PanelClaim[] = [];
  for (const resource of server.panels.listResources()) {
    const content = server.panels.getResourceContent(resource.uri);
    for (const meta of [resource._meta, content?._meta]) {
      const sorti = meta?.[SORTI_META_NAMESPACE] as { clientEngine?: PanelClaim["clientEngine"] } | undefined;
      if (!sorti?.clientEngine) continue;
      claims.push({
        uri: resource.uri,
        panelKind: (meta?.ui as { panelKind?: unknown } | undefined)?.panelKind,
        clientEngine: sorti.clientEngine,
      });
      break;
    }
  }
  return claims;
}

/**
 * Shipped source only. `tests/` is excluded so this file's own prose about the
 * removed seam cannot trip its own arm — the trap a text-scanning ratchet
 * always springs on itself — and `vendor/` is excluded because the shim MIRRORS
 * the host contract: it may DEFINE `registerClientEngine`, the cartridge may
 * not CALL it.
 */
function shippedSourceFiles(): string[] {
  const roots = ["src", "examples", "worker", "scripts"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".wrangler") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry)) files.push(full);
    }
  };
  for (const root of roots) walk(join(REPO_ROOT, root));
  return files;
}

describe("prediction seam", () => {
  describe("the census — a claim must be backed, and machinery must have a claim", () => {
    test("every declared client engine survives the host's loader and matches the authority", async () => {
      for (const claim of collectPanelClaims()) {
        // COUNT 1. `engineId` resolves against a registry populated inside the
        // HOST's build (`registerClientEngine`, called by first-party packages
        // at import time). Sorti's generated barrel discovers no extensions,
        // and a cartridge on your own account is not in that build at all, so
        // this arm can only ever produce the host's `engine-unregistered`
        // refusal. There is no version of this that works; it is not a TODO.
        expect(
          claim.clientEngine.engineId === undefined,
          `${claim.uri} declares clientEngine.engineId — that is the host-build lane and a deployed ` +
            `cartridge is never in the host's build graph. The BYO lane is { url, version }. ` +
            `See PANEL-AUTHORING.md "Prediction".`,
        ).toBe(true);

        // COUNT 4. The host reads a clientEngine declaration only for
        // `panelKind: "l3-bundle"` panels (AppPanelSlot: `l3Bundle ?
        // resolveClientEngine(...) : undefined`). On an HTML panel the
        // declaration is inert — which is the decorative shape exactly.
        expect(
          claim.panelKind,
          `${claim.uri} declares a clientEngine but is not an l3-bundle panel; the host will never read it`,
        ).toBe("l3-bundle");

        const fixture = PREDICTION_FIXTURES[claim.uri];
        expect(
          fixture !== undefined,
          `${claim.uri} declares a clientEngine with no fixture in PREDICTION_FIXTURES. A prediction ` +
            `claim that cannot be driven end to end here is the claim this gate exists to refuse — ` +
            `add its (state, intent, authority view-model) triple.`,
        ).toBe(true);

        const url = String(claim.clientEngine.url ?? "");
        const version = String(claim.clientEngine.version ?? "");
        const served = await worker.fetch(new Request(`https://cartridge.test${new URL(url).pathname}`), {});
        expect(served.status, `${claim.uri} declares ${url} but this worker does not serve it`).toBe(200);

        const verdict = checkClientEngineBundle({
          source: await served.text(),
          declaredVersion: version,
          fixture: fixture!,
        });
        expect(verdict.ok ? "" : verdict.reason, `${claim.uri}: ${url}`).toBe("");
      }
    });

    test("no half-seam: nothing registers or serves an engine with no panel using it", () => {
      const claims = collectPanelClaims();
      if (claims.length > 0) return; // a backed claim is checked by the arm above

      const offenders: string[] = [];
      for (const file of shippedSourceFiles()) {
        const text = readFileSync(file, "utf8");
        // A CALL, not a definition — the vendored shim is allowed to mirror the
        // host contract's registry; the cartridge is not allowed to use it.
        if (/\bregisterClientEngine\s*\(/.test(text)) offenders.push(`${relative(REPO_ROOT, file)}: registers a client engine`);
        if (/__sortiClientEngine/.test(text)) offenders.push(`${relative(REPO_ROOT, file)}: writes the sandbox engine global`);
        if (/engine\.client\.js/.test(text)) offenders.push(`${relative(REPO_ROOT, file)}: serves an engine bundle route`);
      }
      expect(
        offenders.join("; "),
        "prediction machinery exists with no panel declaring it — the F1 shape (built, unconsumed) " +
          "that this repo shipped for two weeks. Either wire it to a panel (the census arm above will " +
          "then demand it actually predicts) or delete it.",
      ).toBe("");

      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
        sorti?: Record<string, unknown>;
      };
      expect(Object.keys(pkg.exports ?? {})).not.toContain("./sorti-host");
      expect(pkg.sorti?.hostEntry, "sorti.hostEntry is the host-build lane; a BYO cartridge has no place in it").toBe(
        undefined,
      );
    });

    // ⛔ CONDITIONAL, deliberately. An unconditional "must 404" would forbid the
    // fix as well as the bug — and a gate that makes the honest remedy illegal
    // is just the decorative seam with the sign flipped. When a panel does back
    // a claim, the arm above fetches that bundle and demands 200 plus a real
    // prediction; this one only guards the state we are actually in.
    test("with no panel claiming one, the worker serves no engine bundle", async () => {
      if (collectPanelClaims().length > 0) return;
      const res = await worker.fetch(new Request("https://cartridge.test/engine.client.js"), {});
      expect(res.status).toBe(404);
    });
  });

  describe("the controls — the checker can tell a real bundle from a decorative one", () => {
    test("REJECTS the ESM bundle this repo actually served", () => {
      const verdict = checkClientEngineBundle({
        source: DECORATIVE_ESM_BUNDLE,
        declaredVersion: "0.1.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain("classic script");
      expect((verdict as { reason: string }).reason).toContain("SyntaxError");
    });

    test("REJECTS a bundle that registers only { version, reduce }", () => {
      const verdict = checkClientEngineBundle({
        source: `globalThis.__sortiClientEngine = { version: "1.0.0", reduce: (s) => s };`,
        declaredVersion: "1.0.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain("buildVm");
    });

    test("REJECTS a bundle whose self-report disagrees with the declaration", async () => {
      const verdict = checkClientEngineBundle({
        source: await buildRecipeBundle({ version: "9.9.9" }),
        declaredVersion: "1.0.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain("parity");
    });

    test("REJECTS a bundle that predicts a view-model the authority disagrees with", async () => {
      // The silent wrong answer: everything loads, every verb is present, the
      // versions agree — and the frame is a lie. Nothing but comparing against
      // the authority's own projector catches this.
      const drifted = await buildRecipeBundle({
        mutate: (entry) =>
          entry.replace(
            "  return projector(state);",
            "  const vm = projector(state);\n  if (vm && vm.players) vm.players[0].score += 100;\n  return vm;",
          ),
      });
      const verdict = checkClientEngineBundle({
        source: drifted,
        declaredVersion: "1.0.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain("disagrees with the authority");
    });

    test("REJECTS a bundle that answers an intent it cannot know", async () => {
      const guessing = await buildRecipeBundle({
        mutate: (entry) => entry.replace("  return null;\n}", "  return { kind: \"tap\", playerId: seat };\n}"),
      });
      const verdict = checkClientEngineBundle({
        source: guessing,
        declaredVersion: "1.0.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain("refusing is free");
    });

    test("ACCEPTS a bundle built the way PANEL-AUTHORING describes", async () => {
      const verdict = checkClientEngineBundle({
        source: await buildRecipeBundle(),
        declaredVersion: "1.0.0",
        fixture: DUEL_FIXTURE,
      });
      expect(verdict.ok ? "" : (verdict as { reason: string }).reason).toBe("");
    });
  });

  test("PANEL-AUTHORING.md still states the absence", () => {
    const doc = readFileSync(join(REPO_ROOT, "PANEL-AUTHORING.md"), "utf8");
    // Boolean, not `toContain`: a failing `toContain` prints the ENTIRE 350-line
    // contract into the runner and buries its own message.
    expect(
      doc.includes("## Prediction — this cartridge does not predict"),
      "PANEL-AUTHORING.md lost its Prediction section — the absence has to stay readable, " +
        "or the next author re-derives the decorative seam from first principles",
    ).toBe(true);
  });
});
