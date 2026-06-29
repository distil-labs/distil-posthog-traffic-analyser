/**
 * Per-tool dispatch: route a typed input to whichever engine is
 * configured (slm = distilled or generic small model on the chosen
 * runtime; llm = cloud Anthropic/OpenAI). Returns a unified shape:
 * { output, engine, model, tokens }.
 *
 * Distil Labs is a training platform — they ship the customer a
 * fine-tuned model file. The customer hosts inference (Ollama, vLLM,
 * a Cloudflare Worker fronting an OpenAI-compatible endpoint, etc.).
 * That hosting is the "slm" engine here, parameterised via
 * SLM_PROVIDER + per-tool TOOL_<NAME>_MODEL.
 */
import { extractFromNarration } from "../agents/extractor.ts";
import { narrateSession } from "../agents/narrator.ts";
import { prioritize } from "../agents/prioritizer.ts";
import type {
  ExtractorOutput,
  PrioritizerOutput,
  Session,
  StoredFinding,
} from "../types.ts";
import { buildEngine, getTool, resolveEngine, type Engine } from "./registry.ts";
import type { NarratorOutput } from "./registry.ts";

export interface Dispatched<O> {
  output: O;
  engine: Engine;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function noteEngine<O>(
  engine: Engine,
  model: string,
  inputTokens: number,
  outputTokens: number,
  output: O,
): Dispatched<O> {
  return { engine, model, inputTokens, outputTokens, output };
}

export async function dispatchNarrator(
  session: Session,
  override?: Engine,
): Promise<Dispatched<NarratorOutput>> {
  const spec = getTool("narrator");
  const engine = resolveEngine(spec, override);
  const completer = buildEngine(engine, spec);
  const r = await narrateSession(completer, session);
  return noteEngine(engine, r.model, r.inputTokens, r.outputTokens, {
    sessionId: r.sessionId,
    distinctId: r.distinctId,
    narration: r.narration,
  });
}

export async function dispatchExtractor(
  narration: string,
  override?: Engine,
): Promise<Dispatched<ExtractorOutput>> {
  const spec = getTool("extractor");
  const engine = resolveEngine(spec, override);
  const completer = buildEngine(engine, spec);
  const r = await extractFromNarration(completer, narration);
  return noteEngine(engine, completer.model, r.inputTokens, r.outputTokens, {
    findings: r.findings,
  });
}

export interface PrioritizerDispatchResult extends Dispatched<PrioritizerOutput> {
  missingIds: string[];
  unknownIds: string[];
  duplicateIds: string[];
}

export async function dispatchPrioritizer(
  findings: StoredFinding[],
  override?: Engine,
): Promise<PrioritizerDispatchResult> {
  const spec = getTool("prioritizer");
  const engine = resolveEngine(spec, override);
  const completer = buildEngine(engine, spec);
  const r = await prioritize(completer, findings);
  return {
    ...noteEngine(engine, completer.model, r.inputTokens, r.outputTokens, { ranked: r.ranked }),
    missingIds: r.missingIds,
    unknownIds: r.unknownIds,
    duplicateIds: r.duplicateIds,
  };
}
