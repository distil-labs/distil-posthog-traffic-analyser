import { z } from "zod";

const boolish = z
  .union([z.string(), z.boolean()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const Schema = z.object({
  POSTHOG_API_KEY: z.string().default(""),
  POSTHOG_PROJECT_ID: z.string().default(""),
  POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),

  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-7"),

  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_BASE_URL: z.string().default(""),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  SLM_PROVIDER: z.enum(["ollama", "openai-compatible"]).default("ollama"),

  OLLAMA_HOST: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:7b"),

  DRY_RUN: boolish.prefault("1"),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  DATA_DIR: z.string().default("./data"),
});

export type Settings = z.infer<typeof Schema>;

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  cached = Schema.parse(process.env);
  return cached;
}
