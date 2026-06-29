import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "../util/config.ts";
import { tracker } from "../util/cost.ts";
import { getLogger } from "../util/log.ts";
import { retry } from "../util/retry.ts";

const log = getLogger("llm");

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LLMCompleteOpts {
  system?: string;
  agent?: string;
  maxTokens?: number;
  temperature?: number;
}

export class LLMClient {
  private client: Anthropic;
  readonly model: string;

  constructor(opts: { model?: string; apiKey?: string } = {}) {
    const s = getSettings();
    this.model = opts.model ?? s.ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey ?? s.ANTHROPIC_API_KEY });
  }

  async complete(prompt: string, opts: LLMCompleteOpts = {}): Promise<LLMResponse> {
    const agent = opts.agent ?? "llm";
    log.debug("llm_call", { model: this.model, agent, chars: prompt.length });

    const resp = await retry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.2,
        system: opts.system,
        messages: [{ role: "user", content: prompt }],
      }),
    );

    const text = resp.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const inputTokens = resp.usage.input_tokens;
    const outputTokens = resp.usage.output_tokens;
    tracker.record(agent, this.model, inputTokens, outputTokens);
    return { text, inputTokens, outputTokens, model: this.model };
  }
}
