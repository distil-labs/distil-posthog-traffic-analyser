import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getTool,
  listDistillableTools,
  resolveEngine,
  resolveLLMProvider,
  resolveSLMModel,
  TOOLS,
} from "../src/tools/registry.ts";

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function snapshot(key: string): void {
  if (!(key in ORIGINAL_ENV)) ORIGINAL_ENV[key] = process.env[key];
  delete process.env[key];
}

beforeEach(() => {
  for (const t of Object.values(TOOLS)) {
    snapshot(t.envEngineKey);
    snapshot(t.envLLMProviderKey);
    if (t.envModelKey) snapshot(t.envModelKey);
  }
  snapshot("LLM_PROVIDER");
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("tool registry", () => {
  test("exactly the three expected tools are registered", () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      ["extractor", "narrator", "prioritizer"].sort(),
    );
  });

  test("all three tools are distillable", () => {
    const distillable = listDistillableTools().map((t) => t.name).sort();
    expect(distillable).toEqual(["extractor", "narrator", "prioritizer"]);
  });

  test("default engine: slm for every distillable tool", () => {
    expect(TOOLS.narrator!.defaultEngine).toBe("slm");
    expect(TOOLS.extractor!.defaultEngine).toBe("slm");
    expect(TOOLS.prioritizer!.defaultEngine).toBe("slm");
  });

  test("every tool exposes envModelKey", () => {
    expect(TOOLS.narrator!.envModelKey).toBe("TOOL_NARRATOR_MODEL");
    expect(TOOLS.extractor!.envModelKey).toBe("TOOL_EXTRACTOR_MODEL");
    expect(TOOLS.prioritizer!.envModelKey).toBe("TOOL_PRIORITIZER_MODEL");
  });

  test("each tool has input + output schemas", () => {
    for (const t of Object.values(TOOLS)) {
      expect(t.inputSchema).toBeDefined();
      expect(t.outputSchema).toBeDefined();
      expect(typeof t.inputSchema.safeParse).toBe("function");
      expect(typeof t.outputSchema.safeParse).toBe("function");
    }
  });

  test("getTool throws on unknown", () => {
    expect(() => getTool("nope")).toThrow(/unknown tool/);
  });
});

describe("resolveEngine", () => {
  test("default is slm for every distillable tool", () => {
    expect(resolveEngine(getTool("narrator"))).toBe("slm");
    expect(resolveEngine(getTool("extractor"))).toBe("slm");
    expect(resolveEngine(getTool("prioritizer"))).toBe("slm");
  });

  test("override beats env beats default", () => {
    const narrator = getTool("narrator");
    expect(resolveEngine(narrator, "llm")).toBe("llm");
    process.env[narrator.envEngineKey] = "llm";
    expect(resolveEngine(narrator)).toBe("llm");
    expect(resolveEngine(narrator, "slm")).toBe("slm");
  });

  test("invalid env value rejected", () => {
    const narrator = getTool("narrator");
    process.env[narrator.envEngineKey] = "gpt5";
    expect(() => resolveEngine(narrator)).toThrow(/must be one of/);
  });

  test("empty env falls through to default", () => {
    const extractor = getTool("extractor");
    process.env[extractor.envEngineKey] = "";
    expect(resolveEngine(extractor)).toBe("slm");
  });
});

describe("resolveLLMProvider", () => {
  test("default is anthropic", () => {
    const narrator = getTool("narrator");
    expect(resolveLLMProvider(narrator)).toBe("anthropic");
  });

  test("per-tool env override honored", () => {
    const narrator = getTool("narrator");
    process.env[narrator.envLLMProviderKey] = "openai";
    expect(resolveLLMProvider(narrator)).toBe("openai");
  });

  test("invalid per-tool value rejected", () => {
    const narrator = getTool("narrator");
    process.env[narrator.envLLMProviderKey] = "groq";
    expect(() => resolveLLMProvider(narrator)).toThrow(/must be one of/);
  });

  test("every tool has an envLLMProviderKey", () => {
    for (const t of Object.values(TOOLS)) {
      expect(t.envLLMProviderKey).toBeTruthy();
      expect(t.envLLMProviderKey).toMatch(/^TOOL_.*_LLM_PROVIDER$/);
    }
  });
});

describe("resolveSLMModel", () => {
  test("undefined when env unset", () => {
    const narrator = getTool("narrator");
    expect(resolveSLMModel(narrator)).toBeUndefined();
  });

  test("per-tool model override read from env", () => {
    const narrator = getTool("narrator");
    process.env[narrator.envModelKey!] = "my-distilled-narrator";
    expect(resolveSLMModel(narrator)).toBe("my-distilled-narrator");
  });

  test("empty env value treated as undefined", () => {
    const narrator = getTool("narrator");
    process.env[narrator.envModelKey!] = "";
    expect(resolveSLMModel(narrator)).toBeUndefined();
  });

});

describe("schema validation against known shapes", () => {
  test("narrator output rejects too-short narration", () => {
    const r = TOOLS.narrator!.outputSchema.safeParse({
      sessionId: "s1",
      distinctId: "u1",
      narration: "too short",
    });
    expect(r.success).toBe(false);
  });

  test("extractor output accepts empty findings", () => {
    const r = TOOLS.extractor!.outputSchema.safeParse({ findings: [] });
    expect(r.success).toBe(true);
  });

  test("prioritizer output rejects rank=0", () => {
    const r = TOOLS.prioritizer!.outputSchema.safeParse({
      ranked: [{ id: "x", rank: 0, reason: "bad" }],
    });
    expect(r.success).toBe(false);
  });
});
