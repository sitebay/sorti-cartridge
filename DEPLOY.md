# Deploying to your own Cloudflare account

The server half of a code app is **self-hosted**: it runs on your Cloudflare
account, under your control and your bill (the free plan is plenty for a
small game — the Durable Object uses SQLite-backed storage, which free
accounts support).

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
# → Deployed sorti-game-cookie ... https://sorti-game-cookie.<your-subdomain>.workers.dev
```

Then:

1. Put the printed URL into `src/client-engine/engine-url.ts`
   (`CLIENT_ENGINE_URL`) and deploy once more — panels load the reducer
   bundle from that absolute URL.
2. Smoke-test the endpoints:

```sh
BASE=https://sorti-game-cookie.<your-subdomain>.workers.dev
curl -s $BASE/.well-known/byo-mcp/capabilities.json | head
curl -s -X POST $BASE/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
curl -s -X POST $BASE/mcp -H 'content-type: application/json' -H 'mcp-session-id: demo' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"new_run","arguments":{"seed":1}}}'
curl -s -X POST $BASE/mcp -H 'content-type: application/json' -H 'mcp-session-id: demo' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"duel.read_state"}}'
```

The second and third calls share an `mcp-session-id`, so the run persists in
the session's Durable Object between requests.

## Point Sorti at it

In the Sorti host, add your worker URL as a BYO MCP server. The host reads
`/.well-known/byo-mcp/capabilities.json`, lists your tools, mounts
`ui://duel/board` from `resources/read`, and refreshes it after every
mutating tool call. Conformance is advisory: if your capabilities doc or
wire shapes drift, the host skips or degrades your app — nothing on the
platform side will fix it for you.

## Local dev

```sh
bun run dev          # wrangler dev on http://localhost:8787 (in-memory DO)
```

`wrangler dev` serves the same routes; use the curl calls above against
`http://localhost:8787`.
