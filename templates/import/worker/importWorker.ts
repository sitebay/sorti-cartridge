/**
 * THE IMPORT WRAPPER — your existing app, as a Sorti app.
 *
 * You did not start in the forge; you have an Expo / React Native app with a
 * web export and an HTTP API. This worker is the whole adapter:
 *
 *   your `dist/` web export  ──►  ONE panel resource `ui://<slug>/app`
 *   your API endpoints       ──►  JSON-RPC tools that proxy to it
 *   your `sorti.import.json` ──►  the capabilities document, the manifest and
 *                                 the server card, all DERIVED (never typed
 *                                 three times, never allowed to drift)
 *
 * ── THE PANEL IS YOUR EXPORT, NOT A COPY OF IT ──────────────────────────────
 *
 * A panel resource is an HTML DOCUMENT the host mounts in a sandboxed iframe,
 * and an iframe fed inline HTML has an opaque origin: `/_expo/static/js/…`
 * resolves to nothing at all there. So the export's `index.html` is served with
 * every root-absolute URL rewritten to this worker's `/assets/*` route and a
 * `<base>` for everything the bundle resolves later, plus the `window.SortiPanel`
 * runtime injected so the host's bridge — and the act verbs that ride it —
 * reach a page that was never written for Sorti. Your app's own code is
 * untouched; the rewrite is on the way out the door.
 *
 * ── NO CREDENTIAL LIVES HERE ────────────────────────────────────────────────
 *
 * A tool proxies to your API with the CALLER's `Authorization` header, per
 * call. This worker stores none, defaults to none, and its `Env` has exactly
 * one field — the asset store — so there is nowhere for one to hide. If your
 * API needs a key the person must hold it: connect the app in Sorti with that
 * credential and every call carries it, or leave the endpoint open and every
 * call carries nothing. A worker holding your users' keys is a breach with a
 * deploy button, and the platform's own rule (flagship plan §2e) refuses it.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * Not a reducer app. There is no run state, no action log and no coop room
 * here: an imported app's state lives where it always did, behind your API.
 * When you want the forge's data lane — predicted actions, playtest proofs —
 * that is a different shape (see the cartridge's `examples/`), not a flag.
 */

// ── The config a maker writes ───────────────────────────────────────────────

/** One of your API endpoints, exposed as a tool. */
export interface SortiImportTool {
  /** Tool name. MUST start with `<slug>.` so one capability module claims it. */
  name: string;
  /** One sentence. This is what the agent reads when it decides to call you. */
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Path joined onto `apiBase`. `{placeholders}` are filled from the tool's
   * input (`/site/{fqdn}` + `{fqdn:"a.com"}` → `/site/a.com`); whatever is left
   * rides as query (GET) or as the JSON body (anything else).
   */
  path: string;
  /** JSON-Schema for the tool's input. An object schema, as RFC-002 requires. */
  inputSchema: Record<string, unknown>;
}

export interface SortiImportConfig {
  /** Display name, shown on the app's row. */
  name: string;
  /** Lower-case id. The panel is `ui://<slug>/app` and every tool starts `<slug>.`. */
  slug: string;
  /**
   * What the app reports as its identity. The platform's bar stamps *proven* ON
   * this string, so bump it when you deploy — an unchanged version after a
   * deploy is a proof that cannot go stale, which is a proof that cannot be
   * wrong.
   */
  version: string;
  /** Your web export's directory, relative to the repo root (`expo export` writes `dist`). */
  dist: string;
  /** Base URL every tool's path is joined to. */
  apiBase: string;
  tools: SortiImportTool[];
  /**
   * Tools the platform's bar may CALL while it proves your app — published as
   * the capabilities document's `conformance.probeTools`.
   *
   * The bar has to invoke something to prove a tool round-trips and that its
   * envelope has RFC-002's shape. Until 2026-09-11 it invoked a hardcoded list
   * of the REFERENCE app's tool names, so every honestly-named app failed two
   * of seventeen arms; now the app says what is safe (flagship plan §1, "proof
   * never privilege").
   *
   * ⛔ THE BAR CALLS THESE AGAINST YOUR PRODUCTION API, WITH NO ARGUMENTS AND
   * WITH WHATEVER CREDENTIAL THE CALLER HOLDS. Omit it and the kit names every
   * GET tool whose schema requires nothing, which is the honest default for a
   * read-only endpoint. Name a write here and you have asked a stranger's
   * machine to write to your users' data on a schedule you do not control.
   */
  probeTools: string[];
}

/**
 * Everything this worker is given at runtime. ONE field, deliberately: see the
 * credential note above.
 */
export type ImportEnv = {
  /** Your web export, served by Cloudflare (`[assets]` in wrangler.toml). */
  ASSETS: { fetch(input: Request | string): Promise<Response> };
};

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
/** RFC-002 §Tool budget: a capability module may claim at most twenty tools. */
const MAX_TOOLS = 20;
const MCP_APP_MIME = "text/html;profile=mcp-app;version=1";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-session-id",
  "access-control-max-age": "86400",
};

/** A refusal a maker can act on: it names their file and the field in it. */
function refuse(what: string): never {
  throw new Error(`sorti.import.json: ${what}`);
}

function requireString(source: Record<string, unknown>, field: string, where = ""): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    refuse(`${where}"${field}" is required and must be a non-empty string`);
  }
  return (value as string).trim();
}

/**
 * Read and CHECK the maker's config. Every failure names the field, because
 * the first thing anyone runs in this kit is a file they typed by hand, and
 * "Cannot read properties of undefined" sends them into our source instead of
 * into their own.
 */
export function parseImportConfig(raw: string): SortiImportConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    refuse(`could not be parsed as JSON (${(error as Error).message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    refuse("must be a JSON object");
  }
  const source = parsed as Record<string, unknown>;

  const name = requireString(source, "name");
  const slug = requireString(source, "slug");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    refuse(`"slug" must be lower-case letters, digits and dashes — it becomes the panel URI ui://${slug}/app`);
  }
  const dist = requireString(source, "dist");
  const apiBase = requireString(source, "apiBase");
  if (!/^https?:\/\//.test(apiBase)) {
    refuse('"apiBase" must be an http(s) URL — it is the base every tool\'s path is joined to');
  }
  // Optional, with a default: a version is REQUIRED by the capabilities schema,
  // and a maker who has not thought about it yet should still get a legal
  // document rather than a validation error on their first run.
  const version = typeof source.version === "string" && source.version.trim() ? source.version.trim() : "0.0.0";

  if (!Array.isArray(source.tools)) {
    refuse('"tools" is required and must be an array (an app with no tools brings a panel and nothing to call)');
  }
  const rawTools = source.tools as unknown[];
  if (rawTools.length > MAX_TOOLS) {
    refuse(
      `"tools" declares ${rawTools.length} tools; a capability module may claim at most ${MAX_TOOLS} ` +
        `(RFC-002 §Tool budget). Pick the ${MAX_TOOLS} an agent actually needs.`,
    );
  }

  const seen = new Set<string>();
  const tools: SortiImportTool[] = rawTools.map((entry, index) => {
    const where = `tools[${index}]: `;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      refuse(`${where}must be an object`);
    }
    const tool = entry as Record<string, unknown>;
    const toolName = requireString(tool, "name", where);
    if (!toolName.startsWith(`${slug}.`)) {
      refuse(`${where}"name" must use this app's prefix — "${slug}.${toolName.split(".").pop()}", not "${toolName}"`);
    }
    if (seen.has(toolName)) refuse(`${where}"name" ${toolName} is declared twice`);
    seen.add(toolName);
    const description = requireString(tool, "description", where);
    const method = requireString(tool, "method", where).toUpperCase();
    if (!METHODS.has(method)) {
      refuse(`${where}"method" ${method} is not supported — use one of ${[...METHODS].join(", ")}`);
    }
    const path = requireString(tool, "path", where);
    if (!path.startsWith("/")) refuse(`${where}"path" must start with "/" — it is joined onto apiBase`);
    const inputSchema = tool.inputSchema;
    if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
      refuse(`${where}"inputSchema" is required and must be a JSON-Schema object`);
    }
    return {
      name: toolName,
      description,
      method: method as SortiImportTool["method"],
      path,
      inputSchema: inputSchema as Record<string, unknown>,
    };
  });

  // The default: every GET whose schema asks for nothing. A GET is the only
  // method this kit can assume is free of side effects, and a tool that needs
  // an id cannot be called with `{}`.
  const needsInput = (tool: SortiImportTool): boolean => {
    const required = tool.inputSchema.required;
    return Array.isArray(required) && required.length > 0;
  };
  const derived = tools.filter((tool) => tool.method === "GET" && !needsInput(tool)).map((tool) => tool.name);
  let probeTools = derived;
  if (source.probeTools !== undefined) {
    if (!Array.isArray(source.probeTools)) {
      refuse('"probeTools" must be an array of tool names the conformance bar may call');
    }
    probeTools = (source.probeTools as unknown[]).map((entry, index) => {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        refuse(`probeTools[${index}]: must be a non-empty tool name`);
      }
      const wanted = (entry as string).trim();
      if (!seen.has(wanted)) {
        refuse(`probeTools[${index}]: "${wanted}" is not one of this app's tools — the bar can only call what you declare`);
      }
      return wanted;
    });
  }

  return { name, slug, version, dist, apiBase: apiBase.replace(/\/+$/, ""), tools, probeTools };
}

// ── The three derived documents ─────────────────────────────────────────────

export interface ImportManifest {
  id: string;
  displayName: string;
  endpoint: string;
  resources: { uri: string; name: string; mimeType: string }[];
  contracts: { tools: { name: string; description: string; inputSchema: unknown }[] };
}

export interface ImportCapabilities {
  id: string;
  version: string;
  displayName: string;
  kind: "byo-mcp";
  kind_version: "1";
  modules: { id: string; description: string; tools: string[] }[];
  specialists: never[];
  panels: { uri: string }[];
  multiplayer: { supported: boolean };
  /** What the bar may call — see `SortiImportConfig.probeTools`. */
  conformance?: { probeTools: string[] };
}

/** The panel URI: one app, one surface — your export. */
export function panelUriFor(config: SortiImportConfig): string {
  return `ui://${config.slug}/app`;
}

export function buildImportManifest(config: SortiImportConfig): ImportManifest {
  return {
    id: config.slug,
    displayName: config.name,
    endpoint: "/mcp",
    resources: [{ uri: panelUriFor(config), name: config.name, mimeType: MCP_APP_MIME }],
    contracts: {
      tools: config.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    },
  };
}

/**
 * The document the host reads to activate the app. Two things depend on it:
 * the BYO bridge SKIPS a server whose capabilities fail to load, and the
 * allowed-tool caps are built from `modules[].tools` — a tool missing here is
 * refused client-side even when tools/list advertises it.
 */
export function buildImportCapabilities(config: SortiImportConfig): ImportCapabilities {
  return {
    id: config.slug,
    version: config.version,
    displayName: config.name,
    kind: "byo-mcp",
    kind_version: "1",
    modules: [
      {
        id: config.slug,
        description: `${config.name} API tools.`,
        tools: config.tools.map((tool) => tool.name),
      },
    ],
    // No specialists and no coop: an imported app brings a surface and an API.
    specialists: [],
    panels: [{ uri: panelUriFor(config) }],
    multiplayer: { supported: false },
    // Omitted rather than published empty when there is nothing safe to name:
    // the runner then says so in a sentence the maker can act on, instead of
    // being handed an empty promise.
    ...(config.probeTools.length > 0 ? { conformance: { probeTools: config.probeTools } } : {}),
  };
}

/**
 * `/.well-known/mcp/server-card.json` — the STATIC surface catalogs read
 * before they ever open a session. Derived from the same tool list as
 * tools/list, which is the only way the platform's `test-server-card.mjs`
 * (which fails omissions AND phantoms) can be true by construction.
 */
export function buildImportServerCard(config: SortiImportConfig): {
  name: string;
  version: string;
  tools: { name: string; description: string; inputSchema: unknown }[];
  resources: { uri: string; name: string; mimeType: string }[];
} {
  const manifest = buildImportManifest(config);
  return {
    name: config.name,
    version: config.version,
    tools: manifest.contracts.tools,
    resources: manifest.resources,
  };
}

// ── The panel ───────────────────────────────────────────────────────────────

/**
 * The export's `index.html`, addressed at this worker and bridged to the host.
 *
 * Three edits, in order:
 *   1. `<base href="…/assets/">` so anything the bundle resolves at runtime
 *      (a font, a lazily-imported chunk) lands on the worker;
 *   2. every root-absolute `src="/…"` / `href="/…"` rewritten to an ABSOLUTE
 *      url — `<base>` alone does not save these, since `/x` resolves against
 *      the iframe's opaque origin, not the base;
 *   3. the `window.SortiPanel` runtime and one line that starts the handshake.
 */
export function buildPanelHtml(input: {
  indexHtml: string;
  assetBase: string;
  runtimeHtml: string;
  uri: string;
}): string {
  const base = input.assetBase.replace(/\/+$/, "");
  let html = input.indexHtml;

  html = html.replace(/(\s(?:src|href))=("|')\/(?!\/)/g, (_match, attr: string, quote: string) => {
    return `${attr}=${quote}${base}/`;
  });

  const bootstrap =
    `<script>window.SortiPanel.init({ uri: ${JSON.stringify(input.uri)} });</script>`;
  const injection = `<base href="${base}/">\n${input.runtimeHtml.trim()}\n${bootstrap}\n`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (_match, attrs: string) => `<head${attrs}>\n${injection}`);
  } else {
    html = `${injection}${html}`;
  }
  return html;
}

// ── The wire ────────────────────────────────────────────────────────────────

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function isJsonRpc(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { jsonrpc?: unknown; method?: unknown };
  return candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toolError(id: unknown, text: string): unknown {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } };
}

/**
 * Fill `{placeholders}` from the input and hand back what is left over. A
 * placeholder with no value is a refusal rather than a request to
 * `/site/undefined`.
 */
function fillPath(path: string, args: Record<string, unknown>): { path: string; rest: Record<string, unknown> } {
  const rest = { ...args };
  const filled = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = rest[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`this tool's path needs "${key}"`);
    }
    delete rest[key];
    return encodeURIComponent(String(value));
  });
  return { path: filled, rest };
}

function queryFrom(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function createImportWorker(input: { config: SortiImportConfig; runtimeHtml: string }): {
  fetch(request: Request, env: ImportEnv): Promise<Response>;
} {
  const { config, runtimeHtml } = input;
  const uri = panelUriFor(config);
  const byName = new Map(config.tools.map((tool) => [tool.name, tool]));

  /** The export's index.html, straight from the asset store. */
  async function readExport(request: Request, env: ImportEnv): Promise<string | null> {
    if (!env?.ASSETS) return null;
    const assetUrl = new URL("/index.html", request.url);
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    if (!res.ok) return null;
    return res.text();
  }

  /**
   * ONE call to the maker's API. The caller's Authorization header is forwarded
   * and nothing else is: no cookie of ours, no header we invented, and nothing
   * remembered between calls.
   */
  async function proxy(
    tool: SortiImportTool,
    args: Record<string, unknown>,
    caller: Request,
  ): Promise<{ status: number; text: string }> {
    const { path, rest } = fillPath(tool.path, args);
    const isGet = tool.method === "GET";
    const url = `${config.apiBase}${path}${isGet ? queryFrom(rest) : ""}`;
    const authorization = caller.headers.get("authorization");
    const headers: Record<string, string> = { accept: "application/json" };
    if (authorization) headers.authorization = authorization;
    if (!isGet) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method: tool.method,
      headers,
      ...(isGet ? {} : { body: JSON.stringify(rest) }),
    });
    return { status: res.status, text: await res.text() };
  }

  async function handleRpc(payload: JsonRpcRequest, request: Request, env: ImportEnv): Promise<unknown> {
    if (payload.id === undefined && payload.method.startsWith("notifications/")) return null;

    if (payload.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: config.slug, version: config.version },
          capabilities: { tools: {}, resources: { listChanged: false } },
          instructions:
            `${config.name} is an imported app: its one panel (${uri}) is the app's own web build, and its ` +
            `tools call the app's API as the person who is signed in. Read before you write.`,
        },
      };
    }

    if (payload.method === "ping") return { jsonrpc: "2.0", id: payload.id, result: {} };

    if (payload.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          tools: config.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };
    }

    if (payload.method === "tools/call") {
      const name = payload.params?.name;
      const args = recordOrEmpty(payload.params?.arguments);
      const tool = typeof name === "string" ? byName.get(name) : undefined;
      // An unknown TOOL is a tool-level error, not a missing METHOD.
      if (!tool) return toolError(payload.id, `Error: unknown tool "${String(name)}"`);
      try {
        const answer = await proxy(tool, args, request);
        if (answer.status >= 400) {
          return toolError(
            payload.id,
            `Error: ${tool.name} — ${config.name} answered ${answer.status}. ${answer.text.slice(0, 600)}`,
          );
        }
        let structured: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(answer.text) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            structured = parsed as Record<string, unknown>;
          }
        } catch {
          // Not JSON. The text content still carries the answer.
        }
        return {
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            content: [{ type: "text", text: answer.text }],
            ...(structured ? { structuredContent: structured } : {}),
          },
        };
      } catch (error) {
        return toolError(payload.id, `Error: ${tool.name} — ${(error as Error).message ?? String(error)}`);
      }
    }

    if (payload.method === "resources/list") {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          resources: [
            {
              uri,
              name: config.name,
              description: `${config.name}, as it builds for the web.`,
              mimeType: MCP_APP_MIME,
              schemaVersion: 2,
            },
          ],
        },
      };
    }

    if (payload.method === "resources/read") {
      const wanted = typeof payload.params?.uri === "string" ? payload.params.uri : undefined;
      if (!wanted) {
        return { jsonrpc: "2.0", id: payload.id ?? null, error: { code: -32602, message: "resources/read requires uri" } };
      }
      if (wanted !== uri) {
        return { jsonrpc: "2.0", id: payload.id ?? null, error: { code: -32602, message: `unknown resource: ${wanted}` } };
      }
      const indexHtml = await readExport(request, env);
      if (indexHtml === null) {
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32603,
            message:
              `the web export was not found — build it (npm run build:panel) and point [assets] at ` +
              `"${config.dist}" in wrangler.toml`,
          },
        };
      }
      const assetBase = new URL("/assets", request.url).toString();
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          contents: [
            {
              uri,
              mimeType: MCP_APP_MIME,
              schemaVersion: 2,
              text: buildPanelHtml({ indexHtml, assetBase, runtimeHtml, uri }),
              producedAt: new Date().toISOString(),
            },
          ],
        },
      };
    }

    return { jsonrpc: "2.0", id: payload.id ?? null, error: { code: -32601, message: `Method not found: ${payload.method}` } };
  }

  return {
    async fetch(request: Request, env: ImportEnv): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

      if ((url.pathname === "/mcp" || url.pathname === "/") && request.method === "POST") {
        const payload: unknown = await request.json().catch(() => null);
        if (!isJsonRpc(payload)) {
          return Response.json(
            { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        // No `mcp-session-id` echo: this worker keeps no rooms, and echoing a
        // handle is how a server TELLS the conformance suite it routes one.
        return Response.json(await handleRpc(payload, request, env), { headers: CORS_HEADERS });
      }

      if (url.pathname === "/.well-known/mcp") {
        return Response.json({ name: config.slug, endpoint: "/mcp", manifest: "/manifest" }, { headers: CORS_HEADERS });
      }

      if (url.pathname === "/.well-known/mcp/server-card.json") {
        return Response.json(buildImportServerCard(config), { headers: CORS_HEADERS });
      }

      if (url.pathname === "/.well-known/byo-mcp/capabilities.json") {
        return Response.json(buildImportCapabilities(config), { headers: CORS_HEADERS });
      }

      if (url.pathname.startsWith("/assets/") && request.method === "GET") {
        if (!env?.ASSETS) return new Response("no asset store bound", { status: 500, headers: CORS_HEADERS });
        const assetUrl = new URL(url.pathname.slice("/assets".length) + url.search, url.origin);
        const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
        const headers = new Headers(res.headers);
        for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
        return new Response(res.body, { status: res.status, headers });
      }

      if ((url.pathname === "/" || url.pathname === "/manifest") && request.method === "GET") {
        return Response.json(buildImportManifest(config), { headers: CORS_HEADERS });
      }

      return Response.json({ ok: false, error: "not found" }, { status: 404, headers: CORS_HEADERS });
    },
  };
}
