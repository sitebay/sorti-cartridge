#!/usr/bin/env node
/**
 * Regenerates each panel's `template.gen.ts` from its sibling `template.html`.
 *
 * Templates are SOURCE, not generated (PANEL-AUTHORING.md §5) — edit the
 * .html, run `bun run build:templates`, commit both. The .gen.ts wrapper is
 * just `export const TEMPLATE_HTML = ...` so panel servers can import the
 * document as a string without a bundler loader.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panelsDir = join(root, "src", "mcp", "panels");

let count = 0;
for (const entry of readdirSync(panelsDir)) {
  const dir = join(panelsDir, entry);
  if (!statSync(dir).isDirectory()) continue;
  const htmlPath = join(dir, "template.html");
  let html;
  try {
    html = readFileSync(htmlPath, "utf8");
  } catch {
    continue;
  }
  const generated =
    "// GENERATED FILE — do not edit. Source: ./template.html\n" +
    "// Regenerate with: bun run build:templates\n" +
    `export const TEMPLATE_HTML = ${JSON.stringify(html)};\n`;
  writeFileSync(join(dir, "template.gen.ts"), generated);
  count += 1;
  console.log(`built ${entry}/template.gen.ts (${html.length} bytes)`);
}
if (count === 0) {
  console.error("no template.html files found under src/mcp/panels/*/");
  process.exit(1);
}
