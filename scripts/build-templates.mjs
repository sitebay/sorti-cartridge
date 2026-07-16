#!/usr/bin/env node
/**
 * Regenerates each panel's `template.gen.ts` from its sibling `template.html`.
 *
 * Templates are SOURCE, not generated (PANEL-AUTHORING.md §5) — edit the
 * .html, run `bun run build:templates`, commit both. The .gen.ts wrapper is
 * just `export const TEMPLATE_HTML = ...` so panel servers can import the
 * document as a string without a bundler loader.
 *
 * Scans examples/ recursively for template.html (any depth, so multi-panel
 * apps work).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");

const htmlFiles = readdirSync(examplesDir, { recursive: true })
  .map(String)
  .filter((entry) => entry.endsWith("template.html"))
  .map((entry) => join(examplesDir, entry));

if (htmlFiles.length === 0) {
  console.error("no template.html files found under examples/*/");
  process.exit(1);
}

for (const htmlPath of htmlFiles) {
  const html = readFileSync(htmlPath, "utf8");
  const generated =
    "// GENERATED FILE — do not edit. Source: ./template.html\n" +
    "// Regenerate with: bun run build:templates\n" +
    `export const TEMPLATE_HTML = ${JSON.stringify(html)};\n`;
  const outPath = join(dirname(htmlPath), "template.gen.ts");
  writeFileSync(outPath, generated);
  console.log(`built ${relative(root, outPath)} (${html.length} bytes)`);
}
