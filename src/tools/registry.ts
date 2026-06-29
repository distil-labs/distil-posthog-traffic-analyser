import { z } from "zod";
import { LLMClient } from "../integrations/llm.ts";
import { OpenAIClient } from "../integrations/openai.ts";
import { SLMClient } from "../integrations/slm.ts";
import type { Completer } from "../integrations/completer.ts";
import { getSettings } from "../util/config.ts";
import {
  ExtractorOutputSchema,
  PrioritizerOutputSchema,
  SessionSchema,
} from "../types.ts";
import type { StoredFinding } from "../types.ts";

/**
 * Engines:
 *   - "slm": narrow specialist. Today: generic Qwen (Ollama) or an
 *     OpenAI-compatible runtime. Tomorrow: same engine, just point it
 *     at a distilled fine-tune that Distil Labs trained for the tool
 *     (e.g. OLLAMA_MODEL=distil-labs/feedback-extractor-v1, or via
 *     OPENAI_BASE_URL when the model is served behind a Cloudflare
 *     Worker / vLLM endpoint). Distil Labs is a training platform, so
 *     the deployment runtime is the customer's choice.
 *   - "llm":  cloud generalist. Anthropic Claude Opus or OpenAI GPT-5
 *     family. Used as the teacher for collect-training and as the only
 *     teacher engine when generating training data for Distil Labs.
 */
export type Engine = "slm" | "llm";

export interface ToolSpec {
  name: string;
  description: string;
  distillable: boolean;
  defaultEngine: Engine;
  envEngineKey: string;
  envModelKey?: string;
  envLLMProviderKey: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  teacherAgent: string;
}

export type LLMProvider = "anthropic" | "openai";

// Narration tool output: what the SLM ships per session.
export const NarratorOutputSchema = z.object({
  sessionId: z.string(),
  distinctId: z.string(),
  narration: z.string().min(20).max(1200),
});
export type NarratorOutput = z.infer<typeof NarratorOutputSchema>;

// Prioritizer input: list of findings with the fields we hand the model.
const FindingForPriorSchema = z.object({
  id: z.string(),
  kind: z.enum(["bug", "gap"]),
  severity: z.number().int().min(1).max(5),
  occurrences: z.number().int().nonnegative(),
  title: z.string(),
  evidence: z.string(),
});

export const TOOLS: Record<string, ToolSpec> = {
  narrator: {
    name: "narrator",
    description:
      "Convert a raw PostHog session into a 3-sentence plain-English story of what the user did.",
    distillable: true,
    defaultEngine: "slm",
    envEngineKey: "TOOL_NARRATOR_ENGINE",
    envModelKey: "TOOL_NARRATOR_MODEL",
    envLLMProviderKey: "TOOL_NARRATOR_LLM_PROVIDER",
    inputSchema: SessionSchema,
    outputSchema: NarratorOutputSchema,
    teacherAgent: "narrator-teacher",
  },
  extractor: {
    name: "extractor",
    description:
      "Read a narration and emit a strict-JSON list of bug/gap findings with severity and evidence.",
    distillable: true,
    defaultEngine: "slm",
    envEngineKey: "TOOL_EXTRACTOR_ENGINE",
    envModelKey: "TOOL_EXTRACTOR_MODEL",
    envLLMProviderKey: "TOOL_EXTRACTOR_LLM_PROVIDER",
    inputSchema: z.object({ narration: z.string().min(1) }),
    outputSchema: ExtractorOutputSchema,
    teacherAgent: "extractor-teacher",
  },
  prioritizer: {
    name: "prioritizer",
    description:
      "Rank a batch of findings by impact * frequency * effort and return JSON of (id, rank, reason).",
    distillable: true,
    defaultEngine: "slm",
    envEngineKey: "TOOL_PRIORITIZER_ENGINE",
    envModelKey: "TOOL_PRIORITIZER_MODEL",
    envLLMProviderKey: "TOOL_PRIORITIZER_LLM_PROVIDER",
    inputSchema: z.object({ findings: z.array(FindingForPriorSchema) }),
    outputSchema: PrioritizerOutputSchema,
    teacherAgent: "prioritizer-teacher",
  },
};

export function listDistillableTools(): ToolSpec[] {
  return Object.values(TOOLS).filter((t) => t.distillable);
}

export function getTool(name: string): ToolSpec {
  const t = TOOLS[name];
  if (!t) throw new Error(`unknown tool: ${name}`);
  return t;
}

const ENGINE_VALUES = ["slm", "llm"] as const;

function readEnvEngine(key: string): Engine | null {
  const v = process.env[key]?.trim().toLowerCase();
  if (!v) return null;
  if ((ENGINE_VALUES as readonly string[]).includes(v)) return v as Engine;
  throw new Error(`env ${key}=${v} must be one of ${ENGINE_VALUES.join("|")}`);
}

/**
 * Engine resolution order:
 *   1. Explicit --engine override
 *   2. TOOL_<NAME>_ENGINE env var
 *   3. defaultEngine ("slm" for every distillable tool)
 */
export function resolveEngine(tool: ToolSpec, override?: Engine): Engine {
  if (override) return override;
  const fromEnv = readEnvEngine(tool.envEngineKey);
  return fromEnv ?? tool.defaultEngine;
}

const PROVIDER_VALUES = ["anthropic", "openai"] as const;

export function resolveLLMProvider(tool?: ToolSpec): LLMProvider {
  const perTool = tool?.envLLMProviderKey ? process.env[tool.envLLMProviderKey]?.trim().toLowerCase() : undefined;
  const explicit = perTool || undefined;
  if (explicit) {
    if ((PROVIDER_VALUES as readonly string[]).includes(explicit)) return explicit as LLMProvider;
    throw new Error(
      `env ${tool!.envLLMProviderKey}=${explicit} must be one of ${PROVIDER_VALUES.join("|")}`,
    );
  }
  return getSettings().LLM_PROVIDER;
}

/**
 * Resolve the model name for a tool on the "slm" engine. Per-tool
 * TOOL_<NAME>_MODEL beats the global default (OLLAMA_MODEL or
 * OPENAI_MODEL depending on SLM_PROVIDER). This is how a fleet of
 * distilled fine-tunes shipped by Distil Labs gets wired in: each
 * agent points at its own per-tool model.
 */
export function resolveSLMModel(tool: ToolSpec): string | undefined {
  if (!tool.envModelKey) return undefined;
  const v = process.env[tool.envModelKey]?.trim();
  return v || undefined;
}

function buildLLM(tool?: ToolSpec): Completer {
  const provider = resolveLLMProvider(tool);
  if (provider === "openai") return new OpenAIClient();
  return new LLMClient();
}

/**
 * Build the "slm" engine client. SLM_PROVIDER picks the runtime:
 *   - "ollama" (default): local Ollama daemon. Pull a generic model
 *     (qwen2.5:7b) or load a distilled fine-tune the customer owns.
 *   - "openai-compatible": any OpenAI-compatible runtime (vLLM,
 *     LM Studio, llama.cpp server, Cloudflare Worker, Groq, Together,
 *     Fireworks, etc.) reached via OPENAI_BASE_URL.
 *
 * The model override (TOOL_<NAME>_MODEL) flows through here so each
 * tool can name its own distilled weights.
 */
function buildSLM(tool?: ToolSpec): Completer {
  const provider = getSettings().SLM_PROVIDER;
  const model = tool ? resolveSLMModel(tool) : undefined;
  if (provider === "openai-compatible") {
    return new OpenAIClient(model ? { model } : {});
  }
  return new SLMClient(model ? { model } : {});
}

/** Build a prompt-shaped Completer per the resolved engine. */
export function buildEngine(kind: Engine, tool?: ToolSpec): Completer {
  if (kind === "slm") return buildSLM(tool);
  return buildLLM(tool);
}

// Helper for scripts that want a Completer.
export function getEngine(
  toolName: string,
  override?: Engine,
): { engine: Engine; client: Completer } {
  const spec = getTool(toolName);
  const engine = resolveEngine(spec, override);
  return { engine, client: buildEngine(engine, spec) };
}

export type { StoredFinding };
