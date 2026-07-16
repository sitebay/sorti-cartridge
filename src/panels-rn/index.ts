/**
 * Self-registering native renderers. Host apps consume this as a
 * side-effect import, discovered via the package.json `sorti.nativeEntry`
 * field:
 *
 *   import 'sorti-game-cookie/panels-rn';
 *
 * After the import, getNativeRenderers() returns an entry for
 * ui://duel/board and the host's panel surface renders the true RN
 * component instead of the WebView fallback the HTML template drives.
 * Shipping native renderers is OPTIONAL — delete this directory and the
 * `./panels-rn` export if the WebView template is all you need.
 */

import * as React from "react";
import { registerNativePanel, type NativePanelContext } from "../../vendor/sorti-contract/index.ts";
import { DuelPanelNative } from "./DuelPanel.tsx";
import { DUEL_PANEL_RESOURCE_URI } from "../mcp/panels/duel/server.ts";

registerNativePanel(DUEL_PANEL_RESOURCE_URI, (ctx: NativePanelContext) =>
  React.createElement(DuelPanelNative, { ctx }),
);

export { DuelPanelNative } from "./DuelPanel.tsx";
export { DUEL_PANEL_RESOURCE_URI };
