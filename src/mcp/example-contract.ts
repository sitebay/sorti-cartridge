/**
 * The chassis ↔ example contract. An "example" (or your app — a cartridge
 * usually ships exactly one once you delete the examples you don't want)
 * plugs into the chassis by exporting a `CartridgeExample` and registering
 * it in `examples/index.ts`. The chassis owns runs, the action log, and the
 * MCP wire; the example owns its state shape, reducer, and panels.
 */

import type {
  CoopPolicyFactory,
  PanelServer,
  SortiAppQuickAction,
} from "../../vendor/sorti-contract/index.ts";

/** Every run state must at least carry its identity. */
export interface RunStateBase {
  runId: string;
}

/** Runtime deps the chassis injects into an example's panel factories. */
export interface ExampleRuntimeDeps {
  /**
   * The session's active run state, or null when there is no run or the
   * active run belongs to a different example (apps never see each other's
   * state).
   */
  getActiveState(): unknown | null;
  /**
   * THE one mutation path: routes the action through this example's reducer
   * and appends it to the run's action log (replayable by construction).
   */
  dispatch(runId: string, action: unknown): Promise<{ ok: true; state: unknown }>;
  /**
   * Replace the session's active run with a freshly minted state (the
   * `<app>.new_run`-style tool calls this). Returns a clone of the state.
   *
   * ⛔ IDEMPOTENCY KEYS ON THE PRESS, NOT ON RESEMBLANCE (lifted from
   * sts2-engine 0eeb606a). Pass the pressing client's `kickoffId` and a
   * REPEAT of that same press resumes the run it minted — a retry, a
   * double-dispatch, both coop seats submitting one lobby. A different
   * `kickoffId` is a different intent and mints fresh.
   *
   * The alternative sts2 shipped first was to resume whenever the REQUEST
   * resembled a live run, and resemblance cannot tell "my partner already
   * started this — join it" from "I want a new run with the same settings":
   * the two are byte-identical requests. It always guessed resume, so three
   * consecutive embarks returned one run and one seed.
   *
   * Omitting it keeps the plain replace semantics every mint had before.
   */
  mintRun(state: RunStateBase, options?: MintOptions): unknown;
}

/** Options for {@link ExampleRuntimeDeps.mintRun}. */
export interface MintOptions {
  /**
   * Identity of the PRESS that asked for a run — minted once per user gesture
   * by the client, not per request. See `mintRun`.
   */
  kickoffId?: string;
}

export interface CartridgeExample {
  /** Stable app id (also the coop domain + capability-module prefix). */
  id: string;
  displayName: string;
  /** One-paragraph operating manual, merged into initialize.instructions. */
  instructions: string;
  /** Pure reducer for this example's runs. Throws on illegal actions. */
  reduce(state: unknown, action: unknown): { state: unknown; events: unknown[] };
  /** Panel servers (each panel owns its tools, including its mint tool). */
  createPanels(deps: ExampleRuntimeDeps): PanelServer[];
  /** screen_kind → panel URIs the host should open for that screen. */
  screenGroups?: Record<string, string[]>;
  /**
   * Tools a defer-by-default host keeps in the agent's UPFRONT prompt while
   * the rest defer behind tool_search. Your read tool is added for you (every
   * `<app>.read_state` is always-load by pattern); name here the ACTION tools
   * an agent must be able to FIND on turn one — the next phase's verb.
   *
   * ⛔ ONE DECLARATION. `src/mcp/manifest.ts` publishes this list as the
   * capabilities doc's `coop.alwaysLoadTools` AND stamps the same names on
   * `tools/list`. sts2 stamped by name-heuristic while its document listed
   * these by hand, and the two disagreed by eleven tools for months: the whole
   * phase spine deferred while the document swore it did not (sts2 9d02a1fe).
   */
  alwaysLoadTools?: string[];
  /**
   * Tools the platform's conformance bar may CALL on your DEPLOYED app.
   *
   * The bar has to invoke something to prove a tool round-trips and that its
   * envelope has RFC-002's shape, and until 2026-09-11 it invoked a hardcoded
   * list of the REFERENCE app's tool names — so every honestly-named app failed
   * two of seventeen arms and `forge.validate` said *proven: false*. Now the
   * app says what is safe and the runner probes that (flagship plan §1, "proof
   * never privilege"); `src/mcp/manifest.ts` publishes these as the
   * capabilities document's `conformance.probeTools`.
   *
   * ⛔ A PROBE TOOL IS CALLED AGAINST PRODUCTION, WITH NO ARGUMENTS. Name a
   * read or a peek — never a mint, a write or anything that spends. Omitting
   * this is legal: the runner then derives the set from your advertised tools
   * that require no input, which for a reducer app is usually the same answer.
   */
  probeTools?: string[];
  /**
   * Launcher buttons the host draws beside this app's tile. Absent is normal —
   * an app with nothing to launch declares none. A DESTRUCTIVE action (one
   * that discards work in progress) must set `guardLiveRun` and carry both
   * `agentPrompt` and `resumePrompt`.
   */
  quickActions?: SortiAppQuickAction[];
}

/** A coop domain an example provides: its id + the policy factory for it. */
export interface CoopDomainRegistration {
  domain: string;
  factory: CoopPolicyFactory;
}
