import { Ollama } from "ollama";
import { getSettings } from "../util/config.ts";
import { retry } from "../util/retry.ts";

export class Embedder {
  private client: Ollama;
  readonly model: string;

  constructor(opts: { model?: string; host?: string } = {}) {
    const s = getSettings();
    this.model = opts.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    this.client = new Ollama({ host: opts.host ?? s.OLLAMA_HOST });
  }

  async embed(text: string): Promise<number[]> {
    return retry<number[]>(async () => {
      const r = await this.client.embed({ model: this.model, input: text });
      const v = r.embeddings?.[0];
      if (!Array.isArray(v) || v.length === 0) {
        throw new Error("empty embedding from ollama");
      }
      return v;
    });
  }
}
