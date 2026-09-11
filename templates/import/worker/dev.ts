/**
 * The local run — `bun run sorti/worker/dev.ts` (add `--port 8787` to move it).
 *
 * The same worker as the deployed one, with your `dist/` read from disk in
 * place of Cloudflare's asset store. This is what `npm run conformance` points
 * at: the platform's bar can be run against your app before you deploy it
 * once, which is the difference between finding a missing capabilities field in
 * ten seconds and finding it in a support thread.
 *
 * Bun, because your Expo repo already has it. Nothing here ships to
 * Cloudflare.
 */
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { createImportWorker, parseImportConfig, type ImportEnv } from "./importWorker.ts";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = normalize(join(HERE, "..", ".."));

const portArgument = process.argv.findIndex((argument) => argument === "--port");
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : Number(process.env.PORT ?? 8787);

const config = parseImportConfig(readFileSync(join(REPO_ROOT, "sorti.import.json"), "utf8"));
const runtimeHtml = readFileSync(join(HERE, "..", "runtime.html"), "utf8");
const distRoot = join(REPO_ROOT, config.dist);

/**
 * Cloudflare's asset store, standing on your filesystem. Path traversal is
 * refused rather than clamped: this serves a directory of a developer's repo.
 */
const ASSETS: ImportEnv["ASSETS"] = {
  async fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const resolved = normalize(join(distRoot, relative));
    if (!resolved.startsWith(distRoot)) return new Response("refused", { status: 403 });
    const file = Bun.file(resolved);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file);
  },
};

const worker = createImportWorker({ config, runtimeHtml });

const server = Bun.serve({
  port,
  fetch: (request: Request) => worker.fetch(request, { ASSETS }),
});

console.log(`${config.name} — the import worker is on http://127.0.0.1:${server.port}`);
console.log(`  panel:        ui://${config.slug}/app`);
console.log(`  export:       ${distRoot}`);
console.log(`  conformance:  npm run conformance`);
