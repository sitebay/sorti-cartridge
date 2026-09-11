/**
 * THE IMPORT KIT'S PAPERWORK — the config a maker writes, and the three
 * documents a Sorti host reads before it ever opens an RPC session.
 *
 * The kit's promise is that a maker writes ONE file (`sorti.import.json`) and
 * the capabilities document, the manifest and the server card are DERIVED from
 * it. Derived is the whole point: three hand-written documents drift, and the
 * bar's `test-server-card.mjs` exists because one of them did.
 *
 * The capabilities arm validates against the platform's REAL schema file
 * (`packages/sorti-contract/byo/capabilities.schema.json`) rather than a copy,
 * so a schema change is a red arm here rather than a surprise at a maker's
 * first `npm run conformance`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  parseImportConfig,
  buildImportCapabilities,
  buildImportManifest,
  buildImportServerCard,
  type SortiImportConfig,
} from "../templates/import/worker/importWorker.ts";

const TEMPLATE_DIR = join(import.meta.dir, "..", "templates", "import");

/** The example config the maker copies — it must itself be legal. */
const EXAMPLE_CONFIG_PATH = join(TEMPLATE_DIR, "sorti.import.json");

/**
 * The platform's schema lives in the sorti monorepo, which a maker's checkout
 * does not contain. Both paths this repo can be used from are tried, and a
 * miss is SAID rather than skipped — an arm that quietly passes when it cannot
 * find the schema is the kind of green that means nothing.
 */
function contractDir(): string {
  const candidates = [
    process.env.SORTI_CONTRACT_DIR,
    join(import.meta.dir, "..", "..", "..", "sorti", "packages", "sorti-contract"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "byo", "capabilities.schema.json"))) return candidate;
  }
  throw new Error(
    `the BYO capabilities schema was not found — set SORTI_CONTRACT_DIR to your checkout of ` +
      `packages/sorti-contract (tried: ${candidates.join(", ")})`,
  );
}

function goodConfig(): SortiImportConfig {
  return parseImportConfig(readFileSync(EXAMPLE_CONFIG_PATH, "utf8"));
}

/** The example config as a plain object, for field-removal arms. */
function rawExample(): Record<string, unknown> {
  return JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8")) as Record<string, unknown>;
}

// ── A JSON-Schema subset, enough for capabilities.schema.json ───────────────
// Dependency-free on purpose: the cartridge installs three devDependencies and
// a maker's repo should not gain a validator to run the kit's own tests.
type Schema = Record<string, any>;

function validate(schema: Schema, value: unknown, root: Schema, path = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const target = schema.$ref.replace(/^#\//, "").split("/");
    let resolved: any = root;
    for (const segment of target) resolved = resolved?.[segment];
    return validate(resolved as Schema, value, root, path);
  }
  const errors: string[] = [];
  if ("const" in schema && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  if (typeof schema.type === "string" && !matchesType(schema.type, value)) {
    errors.push(`${path} must be ${schema.type}`);
    return errors;
  }
  if (schema.type === "string" || typeof value === "string") {
    if (typeof schema.minLength === "number" && String(value).length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} character(s)`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(String(value))) {
      errors.push(`${path} must match ${schema.pattern}`);
    }
  }
  if (matchesType("object", value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) errors.push(...validate(childSchema as Schema, record[key], root, `${path}.${key}`));
    }
  }
  if (matchesType("array", value)) {
    const list = value as unknown[];
    if (typeof schema.maxItems === "number" && list.length > schema.maxItems) {
      errors.push(`${path} must have at most ${schema.maxItems} item(s)`);
    }
    if (typeof schema.minItems === "number" && list.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      list.forEach((item, index) => errors.push(...validate(schema.items as Schema, item, root, `${path}[${index}]`)));
    }
  }
  return errors;
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === type;
}

describe("sorti.import.json", () => {
  test("the template's own example parses", () => {
    const config = goodConfig();
    expect(config.slug).toBeTruthy();
    expect(config.tools.length).toBeGreaterThan(0);
    expect(config.apiBase.startsWith("https://")).toBe(true);
  });

  // A maker's first run of anything in this kit is against a config they typed
  // by hand. "Cannot read properties of undefined" would send them to our
  // source; a sentence naming the field sends them to their file.
  for (const field of ["name", "slug", "dist", "apiBase", "tools"]) {
    test(`a missing "${field}" is named in the refusal`, () => {
      const raw = rawExample();
      delete raw[field];
      expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(new RegExp(`"${field}"`));
    });
  }

  test("a tool missing its path is named by tool, not by index alone", () => {
    const raw = rawExample();
    const tools = raw.tools as Record<string, unknown>[];
    delete tools[0]!.path;
    expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(/"path"/);
    expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(/tools\[0\]/);
  });

  test("a tool name outside the app's own prefix is refused", () => {
    const raw = rawExample();
    (raw.tools as Record<string, unknown>[])[0]!.name = "somebody_elses.tool";
    expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(/prefix/i);
  });

  test("an unsupported method is named", () => {
    const raw = rawExample();
    (raw.tools as Record<string, unknown>[])[0]!.method = "TRACE";
    expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(/TRACE/);
  });

  test("more than twenty tools is refused with the module budget", () => {
    const raw = rawExample();
    const one = (raw.tools as Record<string, unknown>[])[0]!;
    raw.tools = Array.from({ length: 21 }, (_unused, index) => ({ ...one, name: `${raw.slug}.tool_${index}` }));
    expect(() => parseImportConfig(JSON.stringify(raw))).toThrow(/20/);
  });

  test("unparseable JSON says so, naming the file", () => {
    expect(() => parseImportConfig("{ not json")).toThrow(/sorti\.import\.json/);
  });
});

describe("the three derived documents", () => {
  test("the capabilities document validates against the platform's schema", () => {
    const schema = JSON.parse(readFileSync(join(contractDir(), "byo", "capabilities.schema.json"), "utf8")) as Schema;
    const caps = buildImportCapabilities(goodConfig());
    expect(validate(schema, caps, schema)).toEqual([]);
  });

  test("every tool is claimed by exactly one module, and the panel is declared", () => {
    const config = goodConfig();
    const caps = buildImportCapabilities(config);
    const claimed = caps.modules.flatMap((module) => module.tools);
    expect([...claimed].sort()).toEqual(config.tools.map((tool) => tool.name).sort());
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(caps.panels).toEqual([{ uri: `ui://${config.slug}/app` }]);
    expect(caps.multiplayer).toEqual({ supported: false });
  });

  test("the manifest names the one panel and every tool's schema", () => {
    const config = goodConfig();
    const manifest = buildImportManifest(config);
    expect(manifest.id).toBe(config.slug);
    expect(manifest.endpoint).toBe("/mcp");
    expect(manifest.resources.map((resource) => resource.uri)).toEqual([`ui://${config.slug}/app`]);
    expect(manifest.contracts.tools.map((tool) => tool.name)).toEqual(config.tools.map((tool) => tool.name));
    for (const tool of manifest.contracts.tools) {
      expect(typeof tool.inputSchema).toBe("object");
    }
  });

  // `test-server-card.mjs` fails a card that omits a served tool OR promises an
  // unserved one. Deriving both from the same list is what makes that
  // impossible rather than merely unlikely.
  test("the server card matches the tool list in both directions", () => {
    const config = goodConfig();
    const card = buildImportServerCard(config);
    const manifest = buildImportManifest(config);
    expect(card.name).toBe(config.name);
    expect(card.tools.map((tool) => tool.name).sort()).toEqual(
      manifest.contracts.tools.map((tool) => tool.name).sort(),
    );
    for (const tool of card.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(Array.isArray(tool.inputSchema)).toBe(false);
    }
  });
});

// ── S5b-2: what the bar may CALL ────────────────────────────────────────────
// The suite's two calling arms used to probe a hardcoded list of the reference
// app's tool names, so an imported app failed both for being itself. The app
// declares now, and the kit's default is the honest one: a GET that asks for
// nothing.
describe("probeTools", () => {
  test("defaults to every GET whose schema requires nothing", () => {
    const config = goodConfig();
    // The template's own example: one plain GET, one GET needing an id, one
    // POST. Only the first can be called with `{}` and left alone.
    expect(config.probeTools).toEqual(["fieldnotes.notes"]);
    expect(buildImportCapabilities(config).conformance).toEqual({ probeTools: ["fieldnotes.notes"] });
  });

  test("an explicit list wins, in the maker's order", () => {
    const raw = JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const config = parseImportConfig(JSON.stringify({ ...raw, probeTools: ["fieldnotes.note"] }));
    expect(config.probeTools).toEqual(["fieldnotes.note"]);
    expect(buildImportCapabilities(config).conformance).toEqual({ probeTools: ["fieldnotes.note"] });
  });

  test("a name that is not one of the app's tools is refused, naming it", () => {
    const raw = JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    expect(() => parseImportConfig(JSON.stringify({ ...raw, probeTools: ["fieldnotes.ghost"] }))).toThrow(
      /"fieldnotes\.ghost" is not one of this app's tools/,
    );
    expect(() => parseImportConfig(JSON.stringify({ ...raw, probeTools: "fieldnotes.notes" }))).toThrow(
      /"probeTools" must be an array/,
    );
  });

  test("an app with no callable GET declares nothing, so the bar says what to declare", () => {
    const raw = JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const tools = (raw.tools as Record<string, unknown>[]).filter((tool) => tool.method !== "GET");
    const config = parseImportConfig(JSON.stringify({ ...raw, tools }));
    expect(config.probeTools).toEqual([]);
    // Absent rather than an empty promise: the runner's refusal sentence is
    // what the maker should see, not `probeTools: []`.
    expect(buildImportCapabilities(config).conformance).toBeUndefined();
  });

  test("the declaration validates against the platform's schema", () => {
    const schema = JSON.parse(readFileSync(join(contractDir(), "byo", "capabilities.schema.json"), "utf8")) as Schema;
    const caps = buildImportCapabilities(goodConfig());
    expect(caps.conformance).toBeDefined();
    expect(validate(schema, caps, schema)).toEqual([]);
  });
});

describe("what the maker copies", () => {
  test("the kit ships every file IMPORT.md tells them to copy", () => {
    for (const file of [
      "IMPORT.md",
      "sorti.import.json",
      "runtime.html",
      "conformance.mjs",
      "package-scripts.json",
      "worker/index.ts",
      "worker/importWorker.ts",
      "worker/dev.ts",
      "worker/wrangler.toml",
    ]) {
      expect(existsSync(join(TEMPLATE_DIR, file))).toBe(true);
    }
  });

  test("the two package.json lines are a fragment a maker can paste", () => {
    const scripts = JSON.parse(readFileSync(join(TEMPLATE_DIR, "package-scripts.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(Object.keys(scripts.scripts).sort()).toEqual(["build:panel", "conformance"]);
    expect(scripts.scripts.conformance).toContain("conformance.mjs");
    expect(scripts.scripts["build:panel"]).toContain("build:web");
  });

  // The runtime fragment is the host's half of the wire contract. It is lifted
  // from an example's template, so the message shapes must survive the lift.
  test("the runtime fragment carries the whole handshake", () => {
    const runtime = readFileSync(join(TEMPLATE_DIR, "runtime.html"), "utf8");
    for (const token of [
      "panel-ready",
      "host-ready",
      "tools/call",
      "callId",
      "tool-call/error",
      "ui/notifications/tool-result",
      "window.SortiPanel",
    ]) {
      expect(runtime).toContain(token);
    }
    expect(runtime.trimStart().startsWith("<script>")).toBe(true);
  });
});
