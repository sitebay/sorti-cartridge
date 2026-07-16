/**
 * Client-engine bundle entry — the browser-facing reducer surface, served
 * by the Worker at /engine.client.js for client-side prediction. One bundle
 * carries every example's reducer, keyed by app id in `REDUCERS`; each
 * reducer is the `reduceOne(state, action)` shape prediction runtimes
 * expect. `ENGINE_VERSION` lets panels guard against host/engine drift.
 */

import { reduce as tallyDuelReduce } from "../../examples/tally-duel/reducer.ts";
import { reduce as boardReduce } from "../../examples/board/reducer.ts";

export { ENGINE_VERSION } from "./engine-url.ts";

export const REDUCERS = {
  "tally-duel": tallyDuelReduce,
  board: boardReduce,
} as const;
