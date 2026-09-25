// Distributed beside a trusted starter receipt. Never extracts links or overwrites a directory.
import { readFile, writeFile, mkdir, lstat, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] && resolve(process.argv[2]);
if (!target) throw Error('Usage: node unpack.mjs /path/to/new-directory');
const archive = await readFile(join(here, 'reference.bundle.json.gz'));
const receipt = JSON.parse(await readFile(join(here, 'receipt.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (archive.length > 16 * 1024 * 1024 || hash(archive) !== receipt.sha256) throw Error('Reference archive integrity mismatch');
const bundle = JSON.parse(gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'));
if (bundle.format !== 'sitebaywp.reference-bundle/1' || !Array.isArray(bundle.files) || bundle.files.length > 500)
  throw Error('Invalid reference bundle');
const seen = new Set();
const files = bundle.files.map((file) => {
  if (typeof file.path !== 'string' || file.path.length > 500 || !/^[a-zA-Z0-9._/-]+$/.test(file.path)
    || file.path.split('/').some((part) => !part || part === '.' || part === '..') || seen.has(file.path))
    throw Error('Unsafe or duplicate reference path');
  seen.add(file.path);
  if (typeof file.base64 !== 'string' || file.base64.length > 16 * 1024 * 1024) throw Error('Invalid reference bytes');
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error(`Corrupt reference file: ${file.path}`);
  return { ...file, bytes };
});
try { await lstat(target); throw Error('Destination already exists'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(dirname(target), { recursive: true });
const staging = `${target}.tmp-${process.pid}`;
await mkdir(staging);
try {
  for (const file of files) {
    await mkdir(dirname(join(staging, file.path)), { recursive: true });
    await writeFile(join(staging, file.path), file.bytes, { flag: 'wx', mode: 0o644 });
  }
  await writeFile(join(staging, 'reference.manifest.json'), JSON.stringify({
    format: 'sitebaywp.reference/1', canonicalSource: 'sitebaywp/forge',
    files: bundle.files.map(({ base64: _data, ...file }) => file),
  }, null, 2) + '\n', { flag: 'wx' });
  await rename(staging, target);
  console.log(JSON.stringify({ target, files: files.length, sha256: receipt.sha256 }));
} catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
