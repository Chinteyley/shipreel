// Minimal MCP-over-HTTP client for the Livepeer Agent, plus a ledger that
// records every paid call (tool, model, cost, latency) for the run report.

const CREATIVE = "https://agent.livepeer.org/api/mcp/creative";
const RAW = "https://agent.livepeer.org/api/mcp/raw";

export interface LedgerEntry {
  step: string;
  tool: string;
  model: string | null;
  cost_usd: number;
  ms: number;
  ok: boolean;
  note?: string;
}

interface ToolResult {
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

class McpSession {
  private sid: string | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  constructor(private url: string, private key?: string) {}

  private headers() {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.key) h.Authorization = `Bearer ${this.key}`;
    if (this.sid) h["Mcp-Session-Id"] = this.sid;
    return h;
  }

  private async post(method: string, params: unknown) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sid = sid;
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 300)}`);
    // Streamable HTTP may answer as SSE; the last data frame carries the response.
    const body = text.startsWith("event:") || text.startsWith("data:")
      ? text.split("\n").filter((l) => l.startsWith("data:")).at(-1)!.slice(5)
      : text;
    const msg = JSON.parse(body) as { result?: ToolResult; error?: { message: string } };
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result!;
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.ready ??= this.post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "shipreel", version: "0.1.0" },
    }).then(() => undefined);
    await this.ready;
    return this.post("tools/call", { name, arguments: args });
  }
}

export class Livepeer {
  readonly ledger: LedgerEntry[] = [];
  private creative: McpSession;
  private raw: McpSession;

  constructor(readonly sessionId: string, key = process.env.LIVEPEER_API_KEY) {
    this.creative = new McpSession(CREATIVE, key);
    this.raw = new McpSession(RAW, key);
  }

  get spent() {
    return this.ledger.reduce((s, e) => s + e.cost_usd, 0);
  }

  private record(step: string, tool: string, sc: Record<string, unknown>, t0: number, ok: boolean, note?: string) {
    // A replayed idempotent call was paid for by an earlier run.
    const replay = Boolean(sc.idempotency_replay);
    const cost = replay || !ok ? 0 : Number(sc.cost_usd_estimated ?? 0) || 0;
    const model = (sc.capability as string) ?? null;
    this.ledger.push({ step, tool, model, cost_usd: cost, ms: Date.now() - t0, ok, note: replay ? "replayed from cache" : note });
  }

  private static fail(r: ToolResult): string {
    const sc = r.structuredContent ?? {};
    const err = sc.error as { message?: string } | string | undefined;
    const text = r.content?.find((c) => c.type === "text")?.text ?? "";
    return (typeof err === "string" ? err : err?.message) ?? text.slice(0, 400);
  }

  /**
   * create_media with retries for transient provider failures. The idempotency
   * key is derived from the request, so re-running an unchanged storyboard
   * replays finished renders instead of paying for them again.
   */
  async media(step: string, args: Record<string, unknown>, attempts = 3) {
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 48);
    for (let a = 1; ; a++) {
      try {
        return await this.mediaOnce(step, { ...args, idempotency_key: `sr-${digest}-${a}` });
      } catch (err) {
        // Bad arguments and spend limits fail the same way every time; only retry the rest.
        if (a >= attempts || /validation|budget|spend cap/i.test(String(err))) throw err;
        await Bun.sleep(1500 * a);
      }
    }
  }

  private async mediaOnce(step: string, args: Record<string, unknown>): Promise<{ url: string; model: string; sc: Record<string, unknown> }> {
    const t0 = Date.now();
    const r = await this.creative.call("create_media", { session_id: this.sessionId, on_i2v_timeout: "wait", ...args });
    let sc = r.structuredContent ?? {};
    if (r.isError || sc.error) {
      this.record(step, "create_media", sc, t0, false, Livepeer.fail(r));
      throw new Error(`${step}: ${Livepeer.fail(r)}`);
    }
    if (!sc.url && sc.job_id) {
      try {
        sc = await this.waitJob(sc.job_id as string);
      } catch (err) {
        this.record(step, "create_media", sc, t0, false, String(err));
        throw err;
      }
    }
    if (sc.fallback_fired) {
      this.record(step, "create_media", sc, t0, false, "stock fallback fired");
      throw new Error(`${step}: AI render failed and a stock clip was substituted`);
    }
    this.record(step, "create_media", sc, t0, true, sc.model_note ? String(sc.model_note) : undefined);
    return { url: sc.url as string, model: (sc.capability as string) ?? "?", sc };
  }

  private async waitJob(jobId: string, timeoutMs = 6 * 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.creative.call("get_create_media", { job_id: jobId });
      const sc = r.structuredContent ?? {};
      if (sc.status === "done" && sc.url) return sc;
      if (sc.status === "failed" || sc.status === "cancelled") throw new Error(`${jobId} ${sc.status}: ${Livepeer.fail(r)}`);
      await Bun.sleep(3000);
    }
    throw new Error(`${jobId} timed out`);
  }

  /** Live USD price per billing unit for one capability (free call). */
  async price(capability: string): Promise<number> {
    const r = await this.creative.call("get_pricing", { name: capability });
    const caps = (r.structuredContent?.capabilities ?? []) as { display_price_usd?: number }[];
    return Number(caps[0]?.display_price_usd ?? 0);
  }

  /**
   * Exact-dispatch a capability on the raw surface (text/vision/audio models).
   * With attempts > 1 it retries like `media`, keyed for idempotent replays.
   */
  async run(step: string, capability: string, args: Record<string, unknown>, attempts = 1): Promise<Record<string, unknown>> {
    if (attempts <= 1) return this.runOnce(step, capability, args);
    const digest = new Bun.CryptoHasher("sha256").update(capability + JSON.stringify(args)).digest("hex").slice(0, 48);
    for (let a = 1; ; a++) {
      try {
        return await this.runOnce(step, capability, { ...args, idempotency_key: `sr-${digest}-${a}` });
      } catch (err) {
        if (a >= attempts || /validation|budget|spend cap/i.test(String(err))) throw err;
        await Bun.sleep(1500 * a);
      }
    }
  }

  private async runOnce(step: string, capability: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    const r = await this.raw.call("run_capability", { capability, ...args });
    let sc = r.structuredContent ?? {};
    if (r.isError || sc.ok === false) {
      this.record(step, "run_capability", { ...sc, capability }, t0, false, Livepeer.fail(r));
      throw new Error(`${step}: ${Livepeer.fail(r)}`);
    }
    const result = (sc.result as Record<string, unknown> | undefined) ?? {};
    if (sc.job_id && !sc.url && Object.keys(result).length === 0) {
      try {
        sc = { ...sc, ...(await this.waitJob(sc.job_id as string)) };
      } catch (err) {
        this.record(step, "run_capability", { ...sc, capability }, t0, false, String(err));
        throw err;
      }
    }
    this.record(step, "run_capability", { ...sc, capability }, t0, true);
    // Media capabilities put the asset URL at the top level; text ones fill `result`.
    return sc.url ? { url: sc.url, ...result } : result;
  }

  /** Text LLM on Livepeer. Returns parsed JSON when the model wraps it in a fence. */
  async json<T>(step: string, prompt: string, capability = "gemini-text"): Promise<T> {
    const res = await this.run(step, capability, { prompt, async: false });
    return parseJson<T>(String(res.text ?? ""));
  }

  /** Vision LLM on Livepeer: ask a question about an image, get JSON back. */
  async see<T>(step: string, imageUrl: string, prompt: string): Promise<T> {
    const res = await this.run(step, "nemotron-omni-vision", { source_url: imageUrl, prompt, async: false });
    return parseJson<T>(String(res.text ?? ""));
  }
}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(start > 0 ? body.slice(start) : body) as T;
}
