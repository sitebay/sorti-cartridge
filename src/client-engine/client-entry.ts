/**
 * Client-engine bundle entry — the browser-facing reducer surface.
 * `reduceOne(state, action)` is the contract prediction runtimes expect;
 * `ENGINE_VERSION` lets panels guard against host/engine drift.
 */

export { reduceOne, legalActions } from "../game/reducer.ts";
export { ENGINE_VERSION } from "./engine-url.ts";
