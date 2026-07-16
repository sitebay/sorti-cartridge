/**
 * Self-registering native renderers. Host apps consume this as a
 * side-effect import, discovered via the package.json `sorti.nativeEntry`
 * field:
 *
 *   import 'sorti-cartridge/panels-rn';
 *
 * Native renderers are OPTIONAL per example (the HTML template is always
 * the fallback). This barrel is the one place that imports example RN
 * modules — examples/index.ts stays React-free so the server-side graph
 * never pulls TSX. Add a line here when your example ships a native panel;
 * delete the example's panels-rn/ dir and its line here when it doesn't.
 */

import * as React from "react";
import { registerNativePanel, type NativePanelContext } from "../../vendor/sorti-contract/index.ts";
import { DuelPanelNative } from "../../examples/tally-duel/panels-rn/DuelPanel.tsx";
import { DUEL_PANEL_RESOURCE_URI } from "../../examples/tally-duel/panel/server.ts";

registerNativePanel(DUEL_PANEL_RESOURCE_URI, (ctx: NativePanelContext) =>
  React.createElement(DuelPanelNative, { ctx }),
);
// The board example intentionally ships no native renderer — its HTML
// template is the whole panel. That's the common case.

export { DuelPanelNative } from "../../examples/tally-duel/panels-rn/DuelPanel.tsx";
export { DUEL_PANEL_RESOURCE_URI };
