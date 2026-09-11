#!/usr/bin/env node
/**
 * `npm run conformance` — the platform's own bar, run against YOUR worker.
 *
 * The suite is the one Sorti runs remotely to decide whether your app's row
 * says *proven* or *promises theirs* (discovery, capabilities, the server card,
 * a JSON-RPC round trip, a panel resource). It lives in the Sorti contract
 * package, so this script's only job is to FIND it and say something useful
 * when it cannot, in the three places it can honestly be:
 *
 *   1. $SORTI_CONFORMANCE_DIR            — you point at a checkout
 *   2. node_modules/@sitebay/sorti-contract/byo/conformance
 *   3. sorti/conformance/                — you vendored the bundle (its README
 *                                          says to: copy the directory in)
 *
 * Usage: node sorti/conformance.mjs --target=http://127.0.0.1:8787
 * Start the target first: bun run sorti/worker/dev.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const target =
  process.argv.find((argument) => argument.startsWith('--target='))?.slice('--target='.length) ??
  process.env.SORTI_CONFORMANCE_TARGET ??
  'http://127.0.0.1:8787';

const candidates = [
  process.env.SORTI_CONFORMANCE_DIR,
  join(REPO_ROOT, 'node_modules', '@sitebay', 'sorti-contract', 'byo', 'conformance'),
  join(HERE, 'conformance'),
].filter(Boolean);

const found = candidates.find((candidate) => existsSync(join(candidate, 'run-all.mjs')));
if (!found) {
  console.error(
    "the BYO conformance suite was not found. It ships with the Sorti contract package — set " +
      'SORTI_CONFORMANCE_DIR to a checkout of packages/sorti-contract/byo/conformance, or copy that ' +
      'directory to sorti/conformance/. Looked in:\n' +
      candidates.map((candidate) => `  ${candidate}`).join('\n'),
  );
  process.exit(2);
}

const result = spawnSync(process.execPath, [join(found, 'run-all.mjs'), `--target=${target}`], { stdio: 'inherit' });
process.exit(result.status ?? 1);
