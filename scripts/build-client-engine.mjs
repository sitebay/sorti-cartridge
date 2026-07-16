#!/usr/bin/env bun
/**
 * Bundles the pure reducer into a browser ES module and wraps it in
 * `src/client-engine/engine-client.generated.ts` (a string constant the
 * Worker serves at /engine.client.js). Panels import that URL to run the
 * SAME reducer client-side for optimistic prediction.
 *
 * Run with bun (it uses Bun.build): `bun run build:client-engine`.
 * The generated file is committed so install→test→deploy needs no build step.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "src", "client-engine", "client-entry.ts");
const outFile = join(root, "src", "client-engine", "engine-client.generated.ts");

const result = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "esm",
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const bundle = await result.outputs[0].text();

const generated =
  "// GENERATED FILE — do not edit. Source: ./client-entry.ts (+ src/game/*)\n" +
  "// Regenerate with: bun run build:client-engine\n" +
  `export const ENGINE_CLIENT_JS = ${JSON.stringify(bundle)};\n`;

await Bun.write(outFile, generated);
console.log(`built engine-client.generated.ts (${bundle.length} bytes)`);
