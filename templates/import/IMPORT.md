# Import your Expo app in ten minutes

You already have the app. This kit wraps it so Sorti can mount it and an agent
can work in it: your web export becomes the panel, your API becomes the tools,
and your repo becomes the thing the forge's code lane improves.

Nothing about your app changes. The wrapper lives in one folder and one config
file, and it is all yours to delete if you change your mind.

## What you need

- An Expo / React Native app with a web build (`expo export --platform web`, or
  any command that writes a static site).
- An HTTP API the app already talks to.
- A Cloudflare account for the worker (your account; Sorti never runs your
  server code).

## 1. Copy the template

```sh
cp -r path/to/sorti-cartridge/templates/import ./sorti
mv sorti/sorti.import.json .        # the config lives at your repo root
```

You now have `sorti/worker/` (the wrapper), `sorti/runtime.html` (the panel
runtime), `sorti/conformance.mjs` (the bar) and `sorti.import.json` (yours to
fill in).

## 2. Write `sorti.import.json`

| Field | What it is |
|---|---|
| `name` | Display name, shown on your app's row. |
| `slug` | Lower-case id. Your panel becomes `ui://<slug>/app` and every tool must start `<slug>.`. |
| `version` | What your app reports as its identity. Sorti's bar stamps *proven* on this string — bump it when you deploy, so a stale proof can say it is stale. |
| `dist` | Your web build's directory, relative to the repo root. |
| `apiBase` | The base URL every tool's path is joined to. |
| `tools[]` | `name`, `description`, `method`, `path`, `inputSchema` — one per endpoint you want an agent to be able to call. |
| `probeTools[]` | Optional. The tools Sorti's bar may CALL, with no arguments, against your deployed app while it proves your listing. Leave it out and the kit names every `GET` whose schema requires nothing — the honest default. Never name a write: the bar calls these for real. |

A tool's `path` may carry `{placeholders}`: `/v1/notes/{note_id}` with
`{ "note_id": "abc" }` calls `/v1/notes/abc`. Whatever the placeholders do not
consume rides as the query string (`GET`) or the JSON body (anything else).

Start with three or four reads. Twenty tools is the ceiling (RFC-002's
per-module budget) and an agent reads every description you write, so a short,
honest list beats your whole API surface.

**A word about credentials.** A tool call carries the *caller's*
`Authorization` header to your API, per call. The worker stores nothing, and
its environment has exactly one field — your asset store. If your API needs a
key, the person connecting the app in Sorti supplies it; do not put one in the
worker.

## 3. Build the export

Add the two lines from `sorti/package-scripts.json` to your `package.json`:

```json
"conformance": "node sorti/conformance.mjs --target=http://127.0.0.1:8787",
"build:panel": "npm run build:web"
```

`build:panel` calls your own web build. If your app has no `build:web`, point
it at whatever produces your static site (`expo export --platform web`).

```sh
npm run build:panel
```

## 4. Run it, and run the bar

```sh
bun run sorti/worker/dev.ts        # the worker, on :8787, reading dist/ from disk
npm run conformance                # the platform's bar, against :8787
```

The bar is the same suite Sorti runs remotely against your deployed app:
discovery, the capabilities document, the server card, a JSON-RPC round trip, a
panel resource. Green here means green there.

If it cannot find the suite it tells you where it looked — it ships with the
Sorti contract package, and the bundle can also be vendored into
`sorti/conformance/`.

## 5. Deploy

```sh
cd sorti/worker
bunx wrangler deploy               # → https://<name>.<you>.workers.dev
```

Check that `[assets] directory` in `wrangler.toml` points at the same folder as
`dist` in your config, and give the worker a name you will recognise.

## 6. Add it in Sorti

Open the Tools tab, add your worker's URL, and grant the app what it asks for.
Your panel mounts, your tools appear, and the row says *promises theirs* until
the bar passes against the deployed app — then it says *proven*, stamped on the
`version` your capabilities document reported.

## What you get, and what you do not

Your panel is your own web build, so every screen you have already written is
there. The agent can call your tools, and it can act inside the page the way a
person would.

You do not get the forge's data lane — predicted actions, playtest proofs, a
reducer the platform can replay. Those belong to apps built as data
definitions, and they are a different shape rather than a setting (see the
cartridge's `examples/`). An imported app keeps its state where it always kept
it: behind your API.

## Troubleshooting

| What you see | What it means |
|---|---|
| `the web export was not found` | `npm run build:panel` has not run, or `dist` and `[assets] directory` disagree. |
| A blank panel with 404s for `/_expo/...` | You are serving an export whose asset paths were rewritten for another origin. Rebuild and redeploy — the worker rewrites them at read time from your live export. |
| `"name" must use this app's prefix` | Tool names are `<slug>.<verb>`; that prefix is how one capability module claims every tool. |
| `No tool can be probed` | Every tool you declared needs an argument, so the bar has nothing safe to call. Add `"probeTools": ["<slug>.<a read>"]` naming a tool that takes none and changes nothing. |
| `"<name>" is not one of this app's tools` | A name in `probeTools` is not in `tools[]`. The bar can only call what you declare. |
