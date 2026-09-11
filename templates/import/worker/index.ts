/**
 * The deployable entry — `wrangler deploy` starts here.
 *
 * Everything interesting is in `importWorker.ts`; this file exists to bind the
 * three things that are yours: your config, the panel runtime, and (through
 * wrangler.toml's `[assets]`) your web export.
 *
 * Paths assume the template was copied to `<your repo>/sorti/` and
 * `sorti.import.json` sits at the repo root, next to `package.json`. If you
 * put them somewhere else, these two lines are the only ones to change.
 */
import config from "../../sorti.import.json";
import runtimeHtml from "../runtime.html";

import { createImportWorker, parseImportConfig, type ImportEnv } from "./importWorker.ts";

// Re-checked at boot rather than trusted: a config that lost a field in an
// edit fails HERE, in your deploy log, instead of at a stranger's first call.
const worker = createImportWorker({ config: parseImportConfig(JSON.stringify(config)), runtimeHtml });

export type Env = ImportEnv;

export default {
  fetch(request: Request, env: ImportEnv): Promise<Response> {
    return worker.fetch(request, env);
  },
};
