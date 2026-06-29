import { Ollama } from "ollama";
import { getSettings } from "../util/config.ts";
import { tracker } from "../util/cost.ts";
import { getLogger } from "../util/log.ts";
import { retry } from "../util/retry.ts";

const log = getLogger("slm");

export interface SLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface SLMCompleteOpts {
  system?: string;
  agent?: string;
  temperature?: number;
}

export class SLMClient {
  private client: Ollama;
  readonly model: string;

  constructor(opts: { model?: string; host?: string } = {}) {
    const s = getSettings();
    this.model = opts.model ?? s.OLLAMA_MODEL;
    this.client = new Ollama({ host: opts.host ?? s.OLLAMA_HOST });
  }

  async complete(prompt: string, opts: SLMCompleteOpts = {}): Promise<SLMResponse> {
    const agent = opts.agent ?? "slm";
    const messages: { role: string; content: string }[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });
    log.debug("slm_call", { model: this.model, agent, chars: prompt.length });

    const resp = await retry(() =>
      this.client.chat({
        model: this.model,
        messages,
        options: { temperature: opts.temperature ?? 0.2 },
      }),
    );

    const text = resp.message?.content ?? "";
    const inputTokens = resp.prompt_eval_count ?? 0;
    const outputTokens = resp.eval_count ?? 0;
    tracker.record(agent, this.model, inputTokens, outputTokens);
    return { text, inputTokens, outputTokens, model: this.model };
  }
}
