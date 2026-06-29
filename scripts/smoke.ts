import { LLMClient } from "../src/integrations/llm.ts";
import { SLMClient } from "../src/integrations/slm.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

const PROMPT = "In one sentence: why is the sky blue?";

registerCostFlush();
const args = new Set(Bun.argv.slice(2));
const skipLLM = args.has("--skip-llm");
const skipSLM = args.has("--skip-slm");

const log = getLogger("smoke");
const s = getSettings();
log.info("settings", { ollamaModel: s.OLLAMA_MODEL, anthropicModel: s.ANTHROPIC_MODEL });

if (!skipSLM) {
  try {
    const slm = new SLMClient();
    const r = await slm.complete(PROMPT, { agent: "smoke-slm" });
    log.info("slm_ok", { model: r.model, inTok: r.inputTokens, outTok: r.outputTokens });
    console.log(`[SLM/${r.model}] ${r.text.trim()}`);
  } catch (e) {
    log.error("slm_fail", { err: String(e) });
    console.error(`[SLM] FAIL: ${String(e)}`);
  }
}

if (!skipLLM) {
  if (!s.ANTHROPIC_API_KEY) {
    console.log("[LLM] skipped (no ANTHROPIC_API_KEY set)");
  } else {
    try {
      const llm = new LLMClient();
      const r = await llm.complete(PROMPT, { agent: "smoke-llm", maxTokens: 200 });
      log.info("llm_ok", { model: r.model, inTok: r.inputTokens, outTok: r.outputTokens });
      console.log(`[LLM/${r.model}] ${r.text.trim()}`);
    } catch (e) {
      log.error("llm_fail", { err: String(e) });
      console.error(`[LLM] FAIL: ${String(e)}`);
    }
  }
}

console.log("\nCost summary:");
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);
