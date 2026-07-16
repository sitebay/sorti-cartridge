/**
 * THE registration seam between examples (apps) and the chassis.
 *
 * Every example listed in EXAMPLES mounts by default: its panels ride the
 * one MCP registry, its tools ride tools/list, and the capabilities doc
 * advertises it. To add your app: create `examples/<your-app>/` (copy an
 * existing example), export a `CartridgeExample` from its index.ts, and add
 * it to the two arrays below. To remove an example, delete its line here
 * and its directory — nothing in src/ references examples directly except
 * through this file (plus src/panels-rn/index.ts for optional native
 * renderers).
 */

import type { CartridgeExample, CoopDomainRegistration } from "../src/mcp/example-contract.ts";
import { tallyDuelExample, tallyDuelCoopDomains } from "./tally-duel/index.ts";
import { boardExample, boardCoopDomains } from "./board/index.ts";

export const EXAMPLES: CartridgeExample[] = [tallyDuelExample, boardExample];

export const COOP_DOMAINS: CoopDomainRegistration[] = [
  ...tallyDuelCoopDomains,
  ...boardCoopDomains,
];
