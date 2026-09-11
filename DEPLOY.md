# Deploying to your own Cloudflare account

The server half of a cartridge is **self-hosted**: it runs on your
Cloudflare account, under your control and your bill (the free plan is
plenty for a small app — the Durable Object uses SQLite-backed storage,
which free accounts support).

## One-time setup

```sh
# 1. Log wrangler into YOUR Cloudflare account (opens a browser)
bunx wrangler login

# 2. Regenerate committed artifacts if you changed templates or the reducer
bun run build
```

## Deploy

```sh
bun run deploy
# = cd worker && wrangler deploy
# → Deployed sorti-cartridge ... https://sorti-cartridge.<your-subdomain>.workers.dev
```

Then smoke-test the endpoints:

```sh
BASE=https://sorti-cartridge.<your-subdomain>.workers.dev
curl -s $BASE/.well-known/byo-mcp/capabilities.json | head
curl -s -X POST $BASE/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
curl -s -X POST $BASE/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"duel.new_run","arguments":{"seed":1},"_meta":{"io.sitebay.sorti/roomId":"demo"}}}'
curl -s -X POST $BASE/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"duel.read_state","_meta":{"io.sitebay.sorti/roomId":"demo"}}}'
```

The second and third calls address the same room through
`params._meta["io.sitebay.sorti/roomId"]` (MCP 2026-07-28), so the run persists
in that room's Durable Object between requests. The resolved id comes back in
the `mcp-session-id` response header.

The deprecated lane still works for unmigrated clients — sending
`-H 'mcp-session-id: demo'` instead of `_meta` routes to the same room. If a
request carries both and they disagree, `_meta` wins.

## Point Sorti at it

In the Sorti host, add your worker URL as a BYO MCP server. The host reads
`/.well-known/byo-mcp/capabilities.json`, lists your tools, mounts your
panels (`ui://duel/board`, `ui://board/notes`) from `resources/read`, and
refreshes them after every mutating tool call. Conformance is advisory: if your capabilities doc or
wire shapes drift, the host skips or degrades your app — nothing on the
platform side will fix it for you.

## Local dev

```sh
bun run dev          # wrangler dev on http://localhost:8787 (in-memory DO)
```

`wrangler dev` serves the same routes; use the curl calls above against
`http://localhost:8787`.
