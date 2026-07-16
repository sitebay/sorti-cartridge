/**
 * The chassis ↔ example contract. An "example" (or your app — a cartridge
 * usually ships exactly one once you delete the examples you don't want)
 * plugs into the chassis by exporting a `CartridgeExample` and registering
 * it in `examples/index.ts`. The chassis owns runs, the action log, and the
 * MCP wire; the example owns its state shape, reducer, and panels.
 */

import type { PanelServer } from "../../vendor/sorti-contract/index.ts";
import type { CoopPolicyFactory } from "../../vendor/sorti-contract/index.ts";

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
   */
  mintRun(state: RunStateBase): unknown;
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
}

/** A coop domain an example provides: its id + the policy factory for it. */
export interface CoopDomainRegistration {
  domain: string;
  factory: CoopPolicyFactory;
}
