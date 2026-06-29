import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSettings } from "./config.ts";

const PRICING: Record<string, [number, number]> = {
  "claude-opus-4-8": [15, 75],
  "claude-opus-4-7": [15, 75],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
  // OpenAI GPT-5 family (per openai-node v6.43 model list + public pricing).
  "gpt-5": [1.25, 10],
  "gpt-5-mini": [0.25, 2],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-5-pro": [1.25, 10],
  "gpt-5-codex": [1.25, 10],
  "gpt-5.1": [1.25, 10],
  "gpt-5.1-mini": [0.25, 2],
  // OpenAI legacy.
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  // SLM placeholders: free at the GPU layer when self-hosted. If a
  // distilled fine-tune is served behind a paid endpoint, add its
  // model name + pricing here. distil-labs/* is left as a hint.
  "qwen2.5:7b": [0, 0],
  "qwen2.5:14b": [0, 0],
};

function priceForFallback(_model: string, _inTok: number, _outTok: number): number {
  return 0;
}

export interface Usage {
  model: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

function priceFor(model: string, inTok: number, outTok: number): number {
  const entry = PRICING[model];
  if (entry) {
    const [ip, op] = entry;
    return (inTok * ip + outTok * op) / 1_000_000;
  }
  return priceForFallback(model, inTok, outTok);
}

class CostTracker {
  private entries: Usage[] = [];
  private dumped = 0;

  record(agent: string, model: string, inputTokens: number, outputTokens: number): Usage {
    const u: Usage = {
      model,
      agent,
      inputTokens,
      outputTokens,
      usd: priceFor(model, inputTokens, outputTokens),
    };
    this.entries.push(u);
    return u;
  }

  totalUsd(): number {
    return this.entries.reduce((acc, u) => acc + u.usd, 0);
  }

  summary(): Record<string, { inputTokens: number; outputTokens: number; usd: number }> {
    const out: Record<string, { inputTokens: number; outputTokens: number; usd: number }> = {};
    for (const u of this.entries) {
      const row = (out[u.agent] ??= { inputTokens: 0, outputTokens: 0, usd: 0 });
      row.inputTokens += u.inputTokens;
      row.outputTokens += u.outputTokens;
      row.usd += u.usd;
    }
    return out;
  }

  /** Append only entries recorded since the last dump. Idempotent. */
  async dump(path?: string): Promise<string> {
    const target = path ?? join(getSettings().DATA_DIR, "cost.jsonl");
    const fresh = this.entries.slice(this.dumped);
    if (fresh.length === 0) return target;
    await mkdir(dirname(target), { recursive: true });
    const body = fresh.map((u) => JSON.stringify(u)).join("\n") + "\n";
    await appendFile(target, body);
    this.dumped = this.entries.length;
    return target;
  }
}

export const tracker = new CostTracker();

let _registered = false;

/**
 * Call once at the top of any script that records cost. Registers a
 * beforeExit hook so the in-memory tracker flushes to cost.jsonl,
 * making report.ts and dashboard.ts see real data across runs.
 */
export function registerCostFlush(): void {
  if (_registered) return;
  _registered = true;
  let flushing = false;
  process.on("beforeExit", async () => {
    if (flushing) return;
    flushing = true;
    try {
      await tracker.dump();
    } catch {
      // best-effort; don't block exit
    }
  });
}
