/**
 * Host-side registration barrel. Host apps (sorti) consume this as a
 * side-effect import, discovered through the package.json `sorti.hostEntry`
 * field — the host needs no per-app URI knowledge:
 *
 *   import 'sorti-cartridge/sorti-host';
 *
 * After the import, getClientEngine('sorti-cartridge') returns the reducer
 * bundle URL. A panel opts in by declaring
 * `_meta["io.sitebay.sorti"].clientEngine = { engineId: 'sorti-cartridge' }`;
 * the host attaches the bundle to host-ready for client-side prediction.
 * Prediction is OPTIONAL — the example panels work round-trip-only; this
 * seam is here so the wiring path matches the reference app when you
 * outgrow round trips.
 */

import { registerClientEngine } from "../../vendor/sorti-contract/index.ts";
import { CLIENT_ENGINE_URL, ENGINE_ID, ENGINE_VERSION } from "./engine-url.ts";

registerClientEngine(ENGINE_ID, { url: CLIENT_ENGINE_URL, version: ENGINE_VERSION });
