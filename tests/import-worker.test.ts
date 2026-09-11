/**
 * THE IMPORTED APP'S WORKER — the maker's web export as a panel, the maker's
 * API as tools, and NO credential of anyone's in between.
 *
 * The four routes a Sorti host reads are the cartridge worker's four, plus the
 * server card the platform's conformance suite requires. What is new here is
 * the panel: instead of a hand-written template, the one resource is the
 * maker's `dist/index.html` with its asset URLs pointed at this worker and the
 * `window.SortiPanel` runtime injected, so the host's bridge (and the act
 * verbs that ride it) reach a page that was never written for Sorti.
 *
 * The credential arms are the reason this file runs a REAL upstream on a real
 * socket: "the caller's bearer, per call, never stored" is a claim about what
 * a second request carries, and only a server that saw both requests can
 * witness it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createImportWorker, parseImportConfig, type ImportEnv } from "../templates/import/worker/importWorker.ts";

const TEMPLATE_DIR = join(import.meta.dir, "..", "templates", "import");
const RUNTIME_HTML = readFileSync(join(TEMPLATE_DIR, "runtime.html"), "utf8");

/**
 * A STUB EXPORT — the smallest thing shaped like `expo export --platform web`:
 * an index.html whose script and stylesheet are root-absolute (that is what
 * Expo emits), plus one asset. A panel mounted as inline HTML has an opaque
 * origin, so a root-absolute `/…` resolves to nothing at all — rewriting these
 * two lines is the entire reason the panel builder exists.
 */
const STUB_INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Stub App</title>
    <link rel="stylesheet" href="/_expo/static/css/web-abc.css" />
    <link rel="icon" href="/favicon.ico" />
  </head>
  <body>
    <div id="root"></div>
    <script src="/_expo/static/js/web/entry-def.js" defer></script>
  </body>
</html>`;

const STUB_ASSETS: Record<string, { body: string; type: string }> = {
  "/index.html": { body: STUB_INDEX, type: "text/html; charset=utf-8" },
  "/_expo/static/css/web-abc.css": { body: "#root{color:rebeccapurple}", type: "text/css" },
  "/_expo/static/js/web/entry-def.js": { body: "globalThis.__stubApp = true;", type: "text/javascript" },
};

function stubAssets(): ImportEnv["ASSETS"] {
  return {
    async fetch(input: Request | string): Promise<Response> {
      const url = new URL(typeof input === "string" ? input : input.url);
      const hit = STUB_ASSETS[url.pathname];
      if (!hit) return new Response("not found", { status: 404 });
      return new Response(hit.body, { status: 200, headers: { "content-type": hit.type } });
    },
  };
}

/** The maker's API: records every request so the credential arms can read it. */
const seen: { path: string; method: string; auth: string | null; body: string }[] = [];
const upstream = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "GET" ? "" : await request.text();
    seen.push({
      path: `${url.pathname}${url.search}`,
      method: request.method,
      auth: request.headers.get("authorization"),
      body,
    });
    if (url.pathname.endsWith("/boom")) {
      return new Response(JSON.stringify({ detail: "upstream said no" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return Response.json({ ok: true, path: url.pathname, query: Object.fromEntries(url.searchParams) });
  },
});
afterAll(() => upstream.stop(true));

const CONFIG = () =>
  parseImportConfig(
    JSON.stringify({
      name: "Stub App",
      slug: "stubapp",
      version: "1.2.3",
      dist: "dist",
      apiBase: `http://127.0.0.1:${upstream.port}/api`,
      tools: [
        {
          name: "stubapp.things",
          description: "List the things.",
          method: "GET",
          path: "/things",
          inputSchema: { type: "object", properties: { page: { type: "number" } } },
        },
        {
          name: "stubapp.make_thing",
          description: "Make a thing.",
          method: "POST",
          path: "/things",
          inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
        },
        {
          name: "stubapp.thing",
          description: "Read one thing by id.",
          method: "GET",
          path: "/things/{id}",
          inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
        {
          name: "stubapp.boom",
          description: "A tool whose upstream fails.",
          method: "GET",
          path: "/boom",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
  );

const worker = () => createImportWorker({ config: CONFIG(), runtimeHtml: RUNTIME_HTML });

function rpc(method: string, params: Record<string, unknown> = {}, auth?: string): Request {
  return new Request("https://app.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
}

async function call(name: string, args: Record<string, unknown>, auth?: string) {
  const res = await worker().fetch(rpc("tools/call", { name, arguments: args }, auth), { ASSETS: stubAssets() });
  return (await res.json()) as { result?: any; error?: { code: number; message: string } };
}

describe("the four routes (and the card the bar needs)", () => {
  test("GET /.well-known/mcp points at the endpoint and the manifest", async () => {
    const res = await worker().fetch(new Request("https://app.test/.well-known/mcp"), { ASSETS: stubAssets() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "stubapp", endpoint: "/mcp", manifest: "/manifest" });
  });

  test("GET the capabilities document", async () => {
    const res = await worker().fetch(new Request("https://app.test/.well-known/byo-mcp/capabilities.json"), {
      ASSETS: stubAssets(),
    });
    expect(res.status).toBe(200);
    const caps = (await res.json()) as { kind: string; version: string; panels: { uri: string }[] };
    expect(caps.kind).toBe("byo-mcp");
    expect(caps.version).toBe("1.2.3");
    expect(caps.panels).toEqual([{ uri: "ui://stubapp/app" }]);
  });

  // S5b-2: the document tells the bar what it may CALL, so the bar stops
  // probing the reference app's tool names and failing everyone else.
  test("the capabilities document declares what the bar may probe", async () => {
    const res = await worker().fetch(new Request("https://app.test/.well-known/byo-mcp/capabilities.json"), {
      ASSETS: stubAssets(),
    });
    const caps = (await res.json()) as {
      modules: { tools: string[] }[];
      conformance?: { probeTools: string[] };
    };
    // Both argument-free GETs; the POST and the GET that needs an id are out.
    expect(caps.conformance?.probeTools).toEqual(["stubapp.things", "stubapp.boom"]);
    const advertised = caps.modules.flatMap((module) => module.tools);
    for (const name of caps.conformance!.probeTools) expect(advertised).toContain(name);
  });

  test("a declared probe tool answers a no-argument call the way the bar asks it", async () => {
    const answer = await call("stubapp.things", {});
    expect(answer.error).toBeUndefined();
    expect(answer.result.isError ?? false).toBe(false);
    expect(typeof answer.result.content?.[0]?.text).toBe("string");
  });

  test("GET /manifest", async () => {
    const res = await worker().fetch(new Request("https://app.test/manifest"), { ASSETS: stubAssets() });
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as { contracts: { tools: { name: string }[] } };
    expect(manifest.contracts.tools.map((tool) => tool.name)).toContain("stubapp.things");
  });

  test("GET the server card — the surface a host reads before connecting", async () => {
    const res = await worker().fetch(new Request("https://app.test/.well-known/mcp/server-card.json"), {
      ASSETS: stubAssets(),
    });
    expect(res.status).toBe(200);
    const card = (await res.json()) as { name: string; tools: { name: string; inputSchema: unknown }[] };
    expect(card.tools.length).toBe(4);
  });

  test("POST /mcp initialize answers with the app's own name", async () => {
    const res = await worker().fetch(rpc("initialize"), { ASSETS: stubAssets() });
    const reply = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
    expect(reply.result.serverInfo).toEqual({ name: "stubapp", version: "1.2.3" });
  });

  test("a non-JSON-RPC body is refused", async () => {
    const res = await worker().fetch(
      new Request("https://app.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      { ASSETS: stubAssets() },
    );
    expect(res.status).toBe(400);
  });
});

describe("the panel is the maker's export", () => {
  test("resources/list declares the one panel with the mcp-app profile", async () => {
    const res = await worker().fetch(rpc("resources/list"), { ASSETS: stubAssets() });
    const reply = (await res.json()) as { result: { resources: { uri: string; mimeType: string }[] } };
    expect(reply.result.resources).toHaveLength(1);
    expect(reply.result.resources[0]!.uri).toBe("ui://stubapp/app");
    expect(reply.result.resources[0]!.mimeType).toBe("text/html;profile=mcp-app;version=1");
  });

  test("resources/read returns the export with its assets pointed at this worker", async () => {
    const res = await worker().fetch(rpc("resources/read", { uri: "ui://stubapp/app" }), { ASSETS: stubAssets() });
    const reply = (await res.json()) as { result: { contents: { text: string; mimeType: string }[] } };
    const html = reply.result.contents[0]!.text;

    // The export's own markup survived.
    expect(html).toContain('<div id="root">');
    expect(html).toContain("<title>Stub App</title>");
    // Root-absolute URLs now address this worker's asset route; none is left.
    expect(html).toContain("https://app.test/assets/_expo/static/js/web/entry-def.js");
    expect(html).toContain("https://app.test/assets/_expo/static/css/web-abc.css");
    expect(html).not.toMatch(/(src|href)="\/[^/]/);
    // Relative URLs the bundle resolves at runtime need a base, too.
    expect(html).toContain('<base href="https://app.test/assets/">');
    // And the host's half of the wire contract is in the document.
    expect(html).toContain("window.SortiPanel");
    expect(html).toContain("panel-ready");
    expect(html).toContain('ui://stubapp/app');
  });

  test("/assets/* serves the export through the ASSETS binding", async () => {
    const res = await worker().fetch(new Request("https://app.test/assets/_expo/static/css/web-abc.css"), {
      ASSETS: stubAssets(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("rebeccapurple");
  });

  test("an unknown resource is a parameter error, not a missing method", async () => {
    const res = await worker().fetch(rpc("resources/read", { uri: "ui://stubapp/nope" }), { ASSETS: stubAssets() });
    const reply = (await res.json()) as { error: { code: number; message: string } };
    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toContain("ui://stubapp/nope");
  });
});

describe("tools proxy to the maker's API", () => {
  test("a GET tool sends its input as query, and answers RFC-002's shape", async () => {
    const before = seen.length;
    const reply = await call("stubapp.things", { page: 2 });
    expect(reply.result.isError).toBeUndefined();
    expect(Array.isArray(reply.result.content)).toBe(true);
    expect(reply.result.content[0]!.type).toBe("text");
    expect(reply.result.structuredContent.ok).toBe(true);
    const request = seen[before]!;
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/things?page=2");
    expect(request.body).toBe("");
  });

  test("a non-GET tool sends its input as a JSON body", async () => {
    const before = seen.length;
    await call("stubapp.make_thing", { label: "hello" });
    const request = seen[before]!;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/things");
    expect(JSON.parse(request.body)).toEqual({ label: "hello" });
  });

  test("a path placeholder is filled from the input and leaves the query", async () => {
    const before = seen.length;
    await call("stubapp.thing", { id: "abc123" });
    expect(seen[before]!.path).toBe("/api/things/abc123");
  });

  test("an upstream failure is a tool error naming the status, never a throw", async () => {
    const reply = await call("stubapp.boom", {});
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toContain("503");
  });

  test("an unknown tool is a tool-level error, not a missing method", async () => {
    const reply = await call("stubapp.nope", {});
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toContain("stubapp.nope");
  });
});

/**
 * §2e's refusal, made mechanical: "any auth shim that stores the person's
 * SiteBay or PostHog credentials in the worker" is out. The bearer is the
 * CALLER's, forwarded per call.
 */
describe("no credential lives here", () => {
  test("the caller's bearer reaches the maker's API verbatim", async () => {
    const before = seen.length;
    await call("stubapp.things", {}, "Bearer caller-token-9f2a");
    expect(seen[before]!.auth).toBe("Bearer caller-token-9f2a");
  });

  test("the NEXT call without one carries none — nothing was kept", async () => {
    await call("stubapp.things", {}, "Bearer caller-token-9f2a");
    const before = seen.length;
    await call("stubapp.things", {});
    expect(seen[before]!.auth).toBeNull();
  });

  test("a second caller's bearer is theirs, not the first caller's", async () => {
    await call("stubapp.things", {}, "Bearer first-caller");
    const before = seen.length;
    await call("stubapp.things", {}, "Bearer second-caller");
    expect(seen[before]!.auth).toBe("Bearer second-caller");
  });

  // The env shape is the durable place a credential would live. A worker whose
  // Env has one field — the asset store — cannot hold a secret by accident,
  // and this arm fails the day someone adds `TOKEN` "just for testing".
  test("the worker's env declares nothing but the asset store", () => {
    const source = readFileSync(join(TEMPLATE_DIR, "worker", "importWorker.ts"), "utf8");
    const env = /export type ImportEnv = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
    expect(env).toContain("ASSETS");
    const fields = [...env.matchAll(/^\s*(?:\/\*\*[\s\S]*?\*\/\s*)?([A-Za-z_][\w]*)\??:/gm)].map((match) => match[1]);
    expect(fields).toEqual(["ASSETS"]);
    expect(env).not.toMatch(/token|secret|password|apiKey|api_key|credential/i);
  });

  test("nor does the deployment config carry one", () => {
    const toml = readFileSync(join(TEMPLATE_DIR, "worker", "wrangler.toml"), "utf8");
    expect(toml).not.toMatch(/^\s*\[vars\]/m);
    expect(toml).not.toMatch(/token|secret|password/i);
  });
});
