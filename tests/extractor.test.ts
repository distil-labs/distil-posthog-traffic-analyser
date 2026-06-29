import { describe, expect, test } from "bun:test";
import {
  buildExtractorPrompt,
  cleanJsonOutput,
  EXTRACTOR_SYSTEM,
} from "../src/agents/extractor.ts";
import { ExtractorOutputSchema } from "../src/types.ts";

describe("extractor", () => {
  test("system prompt names both kinds + JSON shape", () => {
    expect(EXTRACTOR_SYSTEM).toContain("bug");
    expect(EXTRACTOR_SYSTEM).toContain("gap");
    expect(EXTRACTOR_SYSTEM).toContain("findings");
  });

  test("prompt wraps narration in delimiters", () => {
    const p = buildExtractorPrompt("user tried export, failed");
    expect(p).toContain('"""');
    expect(p).toContain("user tried export");
  });

  test("cleanJsonOutput strips ```json fences", () => {
    const raw = '```json\n{"findings":[]}\n```';
    expect(cleanJsonOutput(raw)).toBe('{"findings":[]}');
  });

  test("cleanJsonOutput trims preamble around object", () => {
    const raw = 'Sure here you go: {"findings":[]} thanks';
    expect(cleanJsonOutput(raw)).toBe('{"findings":[]}');
  });

  test("zod accepts valid finding shape", () => {
    const ok = ExtractorOutputSchema.safeParse({
      findings: [{ kind: "bug", severity: 3, title: "Export fails", evidence: "User saw 500 on export." }],
    });
    expect(ok.success).toBe(true);
  });

  test("zod rejects invalid kind", () => {
    const bad = ExtractorOutputSchema.safeParse({
      findings: [{ kind: "neither", severity: 3, title: "x", evidence: "y" }],
    });
    expect(bad.success).toBe(false);
  });

  test("zod rejects severity out of range", () => {
    const bad = ExtractorOutputSchema.safeParse({
      findings: [{ kind: "bug", severity: 9, title: "x", evidence: "y" }],
    });
    expect(bad.success).toBe(false);
  });
});
