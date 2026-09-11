/**
 * THE ALWAYS-LOAD SPINE, DECLARED ONCE — read by the capabilities document
 * (`manifest.ts`, as `coop.alwaysLoadTools`) AND by the `anthropic/alwaysLoad`
 * stamp `tools/list` puts on each tool (`server.ts`).
 *
 * A defer-by-default client keeps stamped tools in the agent's upfront prompt;
 * everything else defers and is reached through tool_search. So the agent must
 * be able to FIND the next thing to do from turn one: the reads, plus whatever
 * ACTION verbs an example names.
 *
 * ⛔ IT IS ONE MODULE BECAUSE THERE MUST BE ONE ANSWER. Lifted from sts2-engine
 * 9d02a1fe: until 2026-09-04 that engine's stamp name-heuristiced its own tools
 * while its capabilities document carried a hand-written list, and the two
 * disagreed by ELEVEN — every phase action tool deferred while the document
 * swore it did not. The host papered over it with a hand-copy of the same
 * names; deleting that copy made a disagreement unrecoverable, which is what
 * made one declaration mandatory rather than tidy.
 *
 * Both consumers call the SAME predicate over the SAME served surface, so the
 * two halves cannot drift; `tests/manifest.test.ts` pins them to each other in
 * both directions anyway, because a law with no tripwire is a comment.
 */

import { EXAMPLES } from "../../examples/index.ts";

/**
 * The ACTION tools examples declare (`CartridgeExample.alwaysLoadTools`).
 * Reads are not listed here — they arrive by the pattern below, which is what
 * no list should have to enumerate.
 */
export const DECLARED_ALWAYS_LOAD: readonly string[] = EXAMPLES.flatMap(
  (example) => example.alwaysLoadTools ?? [],
);

/** The one predicate. Two clauses, and the first is not a heuristic. */
export function isAlwaysLoadTool(name: string): boolean {
  return DECLARED_ALWAYS_LOAD.includes(name) || /\.read_state$/.test(name);
}

/**
 * The resolved list for a given served tool surface — what the capabilities
 * document publishes. Filtering the SERVED names (rather than returning
 * `DECLARED_ALWAYS_LOAD`) is what keeps the document from promising a tool
 * this cartridge does not actually answer.
 */
export function alwaysLoadToolNames(served: readonly string[]): string[] {
  return served.filter(isAlwaysLoadTool);
}
