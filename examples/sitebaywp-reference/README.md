# SiteBayWP ordinary-app reference

Generated from `sitebaywp/forge/`; no private host source is needed to consume it.

```sh
node examples/sitebaywp-reference/unpack.mjs /tmp/sitebaywp-reference
cd /tmp/sitebaywp-reference
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test:browser
bun run drafts:test:browser
bun run drafts:build
bun run dev
```

Open `/drafts` on the loopback server for document editing, reviewed checkpoint restoration and durable write-receipt recovery. The descriptor and paired public SDK tarballs are included. These are local fixture effects, not live WordPress publication.

The unpacker verifies the trusted starter receipt and every file, rejects unsafe paths, and refuses existing destinations. Read the extracted README and AGENTS before editing. Pin/source manifests are integrity records, not independent signatures or a complete offline dependency archive.

This directory travels with the existing Forge scaffold examples. It is not registered in `examples/index.ts` as a five-file `CartridgeExample`, and does not change the existing Worker chassis. A local staged capsule does not update the published starter revision. Native, live-service and independent-agent promotion gates remain open.

Maintainer regeneration, from the canonical reference:

```sh
bun run reference:stage /path/to/sorti-cartridge
bun run reference:stage /path/to/sorti-cartridge --check
```
