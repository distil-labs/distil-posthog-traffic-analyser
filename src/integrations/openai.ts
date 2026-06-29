/**
 * OpenAI LLM client. Implements the Completer interface so it slots
 * into the same dispatch path as LLMClient (Anthropic) and SLMClient
 * (Ollama/Qwen dev fallback).
 *
 * Uses the Responses API (the new canonical surface per the
 * openai-node README v6.43.0), not the deprecated Chat Completions
 * `max_tokens` path.
 */
import OpenAI from "openai";
import type { Completer, CompleterCallOpts, CompleterResponse } from "./completer.ts";
import { getSettings } from "../util/config.ts";
import { tracker } from "../util/cost.ts";
import { getLogger } from "../util/log.ts";
import { retry } from "../util/retry.ts";

const log = getLogger("openai");

export class OpenAIClient implements Completer {
  readonly model: string;
  readonly baseURL: string | null;
  private client: OpenAI;

  constructor(opts: { model?: string; apiKey?: string; baseURL?: string } = {}) {
    const s = getSettings();
    this.model = opts.model ?? s.OPENAI_MODEL;
    const baseURL = opts.baseURL ?? s.OPENAI_BASE_URL;
    this.baseURL = baseURL || null;
    const apiKey = (opts.apiKey ?? s.OPENAI_API_KEY) || "dummy";
    this.client = new OpenAI({
      apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });
  }

  async complete(prompt: string, opts: CompleterCallOpts = {}): Promise<CompleterResponse> {
    const agent = opts.agent ?? "llm";
    log.debug("openai_call", { model: this.model, agent, chars: prompt.length });

    const resp = await retry(() =>
      this.client.responses.create({
        model: this.model,
        instructions: opts.system,
        input: prompt,
        max_output_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.2,
      }),
    );

    const text = resp.output_text ?? "";
    const inputTokens = resp.usage?.input_tokens ?? 0;
    const outputTokens = resp.usage?.output_tokens ?? 0;
    tracker.record(agent, this.model, inputTokens, outputTokens);
    return { text, inputTokens, outputTokens, model: this.model };
  }
}
