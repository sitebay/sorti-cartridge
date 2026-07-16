/**
 * Cartridge-owned coop agent-driver surface, consumed by the agent host as
 * `sorti-cartridge/coop`. The agent supplies the room driver and transport;
 * the examples supply per-domain strategies (see each example's
 * coop-policy.ts) which register here through examples/index.ts.
 *
 * Activation (BYO covenant: the host never names a game domain): point the
 * agent at this module via its domain-modules env seam; its registration
 * barrel imports the module and registers `COOP_DOMAINS` generically.
 * Adding a domain to your example's coopDomains export is the ONLY edit
 * needed to expose it to the agent.
 */

export type {
  CoopPolicyDeps,
  CoopPolicyFactory,
  Policy,
  RoomOpDraft,
  RoomSignalDraft,
  RoomSnapshot,
} from "../../vendor/sorti-contract/index.ts";

export type { CoopDomainRegistration } from "../mcp/example-contract.ts";

export { COOP_DOMAINS } from "../../examples/index.ts";
