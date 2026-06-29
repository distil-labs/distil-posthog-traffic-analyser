import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenAIClient } from "../src/integrations/openai.ts";

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let originalFetch: typeof globalThis.fetch;
let mockCalls: MockCall[] = [];
let mockResponse: () => Response;

function installMock(): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown }) => {
    const url = typeof input === "string" ? input : String(input);
    const h = new Headers((init?.headers ?? {}) as Record<string, string>);
    const headersObj: Record<string, string> = {};
    h.forEach((v, k) => {
      headersObj[k] = v;
    });
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    mockCalls.push({ url, method: init?.method ?? "GET", headers: headersObj, body });
    return mockResponse();
  }) as typeof globalThis.fetch;
}

beforeAll(() => installMock());
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RESPONSES_PAYLOAD = {
  id: "resp_test_001",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "gpt-5-mini",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "hello world", annotations: [] }],
    },
  ],
  output_text: "hello world",
  usage: {
    input_tokens: 42,
    output_tokens: 11,
    total_tokens: 53,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

describe("OpenAIClient", () => {
  test("complete posts to /v1/responses with model, input, instructions, auth", async () => {
    mockCalls = [];
    mockResponse = () => jsonRes(RESPONSES_PAYLOAD);

    const client = new OpenAIClient({ model: "gpt-5-mini", apiKey: "sk_test_xyz" });
    const r = await client.complete("explain in one line", {
      system: "be terse",
      agent: "smoke",
      temperature: 0.1,
      maxTokens: 200,
    });

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]!.method).toBe("POST");
    expect(mockCalls[0]!.url).toContain("/v1/responses");
    expect(mockCalls[0]!.headers["authorization"]).toBe("Bearer sk_test_xyz");
    const body = mockCalls[0]!.body as Record<string, unknown>;
    expect(body.model).toBe("gpt-5-mini");
    expect(body.input).toBe("explain in one line");
    expect(body.instructions).toBe("be terse");
    expect(body.temperature).toBe(0.1);
    expect(body.max_output_tokens).toBe(200);

    expect(r.text).toBe("hello world");
    expect(r.inputTokens).toBe(42);
    expect(r.outputTokens).toBe(11);
    expect(r.model).toBe("gpt-5-mini");
  });

  test("defaults: maxTokens=4096, temperature=0.2, no system header", async () => {
    mockCalls = [];
    mockResponse = () => jsonRes(RESPONSES_PAYLOAD);
    const client = new OpenAIClient({ model: "gpt-5-mini", apiKey: "sk_test" });
    await client.complete("hi");
    const body = mockCalls[0]!.body as Record<string, unknown>;
    expect(body.max_output_tokens).toBe(4096);
    expect(body.temperature).toBe(0.2);
    expect(body.instructions).toBeUndefined();
  });

  test("missing usage fields default to 0", async () => {
    mockCalls = [];
    mockResponse = () =>
      jsonRes({
        ...RESPONSES_PAYLOAD,
        output_text: "ok",
        usage: undefined,
      });
    const client = new OpenAIClient({ model: "gpt-5-mini", apiKey: "sk_test" });
    const r = await client.complete("hi");
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
  });
});
