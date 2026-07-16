/**
 * Engine-owned coop agent-driver surface, consumed by the agent host as
 * `sorti-game-cookie/coop`. The agent supplies the room driver and
 * transport; this package supplies the per-domain strategy plus the
 * contract it satisfies.
 *
 * Activation (BYO covenant: the host never names a game domain): point the
 * agent at this module via its domain-modules env seam; its registration
 * barrel imports the module and registers `COOP_DOMAINS` generically.
 * Adding a domain here is the ONLY edit needed to expose it to the agent.
 */

export type {
  CoopPolicyDeps,
  CoopPolicyFactory,
  Policy,
  RoomOpDraft,
  RoomSignalDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";

import type { CoopPolicyFactory } from "../../vendor/sorti-contract/index.ts";
import { duelPolicy } from "./duel-policy.ts";

export { duelPolicy } from "./duel-policy.ts";

/** A coop domain this package provides: its id + the policy factory for it. */
export interface CoopDomainRegistration {
  domain: string;
  factory: CoopPolicyFactory;
}

export const COOP_DOMAINS: CoopDomainRegistration[] = [
  { domain: "duel", factory: (deps) => duelPolicy(deps) },
];
