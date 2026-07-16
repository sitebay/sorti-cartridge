/**
 * Where the deployed Worker serves this cartridge's client-side reducer
 * bundle (built by `bun run build:client-engine`, served at
 * /engine.client.js).
 *
 * Replace the subdomain after your first `wrangler deploy` — the host loads
 * this URL inside the panel sandbox for client-side prediction.
 */

export const ENGINE_ID = "sorti-cartridge";
export const ENGINE_VERSION = "0.1.0";

export const CLIENT_ENGINE_URL =
  `https://sorti-cartridge.YOUR-SUBDOMAIN.workers.dev/engine.client.js?v=${ENGINE_VERSION}` as const;
