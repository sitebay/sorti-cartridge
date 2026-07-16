/**
 * RunDO — one Durable Object per session, persisting the run record
 * (state + action log) between stateless Worker requests.
 *
 * The Worker is rebuilt per request (PANEL-AUTHORING.md §3): only what is
 * flushed here survives. The op-log rides along so replays stay possible
 * server-side; a bigger app would also persist lobby/session and room
 * records the same way (the reference app keeps four DO classes).
 */

export interface StoredRun {
  state: unknown;
  log: unknown[];
}

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
}

const KEY = "run";

export class RunDO {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/peek") {
      const run = (await this.state.storage.get<StoredRun>(KEY)) ?? null;
      return Response.json({ ok: true, data: { run } });
    }

    if (url.pathname === "/replace" && request.method === "POST") {
      const body = (await request.json()) as { run?: StoredRun };
      if (!body.run || typeof body.run !== "object") {
        return Response.json({ ok: false, error: "run required" }, { status: 400 });
      }
      await this.state.storage.put(KEY, body.run);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/clear" && request.method === "POST") {
      await this.state.storage.delete(KEY);
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
