# SLM Feedback Harness

**Use Distil Labs SLMs to analyze PostHog events.** Instead of sending raw event streams to a generalist LLM (slow, expensive, fragile), three narrow specialists do the work — each one a fine-tunable small model that Distil Labs trains on your data and ships back for you to host.

Built directly from the two references:
- [Vohra's LinkedIn writeup](https://www.linkedin.com/feed/) on the 7-person startup's product-feedback loop → **what to build**.
- [Distil Labs' intelligent harness pattern](https://github.com/distil-labs/distil-self-healing-agent/blob/main/intelligent-harness.md) + [self-healing loop](https://github.com/distil-labs/distil-self-healing-agent/blob/main/self-healing-loop.md) → **how SLMs slot in**.

---

## What it does

```
PostHog events
     │
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3 distillable SLM tools (per Distil Labs' "intelligent harness")    │
│                                                                      │
│  1. Narrator     raw events  ──► 3-sentence story                    │
│  2. Extractor    story       ──► strict JSON of bugs / gaps          │
│                                  (deduped via embeddings)            │
│  3. Prioritizer  findings    ──► ranked JSON with rationale          │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼
   SQLite + markdown report + live HTML dashboard.
   A human reads the findings.
```

Each tool has an explicit input + output zod schema in `src/tools/registry.ts`. The schemas **are** the contracts Distil Labs trains against, so the orchestrator never has to parse free-form text.

| Tool          | Input                       | Output                                                 | Distil Labs target? |
| ------------- | --------------------------- | ------------------------------------------------------ | :-----------------: |
| `narrator`    | one PostHog session         | `{ sessionId, distinctId, narration }`                 | yes                 |
| `extractor`   | `{ narration }`             | `{ findings: [{ kind, severity, title, evidence }] }`  | yes                 |
| `prioritizer` | `{ findings: […] }`         | `{ ranked: [{ id, rank, reason }] }`                   | yes                 |

> The LinkedIn writeup describes more downstream agents (GitHub issue creation, PR coding). Those are deliberately **not** in this repo — they're application code that lives downstream of the SLM analysis. The Distil Labs angle is the analysis itself.

---

## Engines

The three tools each run on one of two engines, selected per tool via env or `--engine`:

| Engine | What it is                                                                                        | When to use                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `slm`  | Whatever model you host: Ollama (Qwen by default) **or** any OpenAI-compatible HTTP runtime (vLLM, LM Studio, Cloudflare Worker, Groq, Together, …). After Distil Labs ships your fine-tunes, you pin each tool's weights here. | Default for every tool. Production runtime.                                                                            |
| `llm`  | Cloud generalist. Anthropic Claude Opus **or** OpenAI GPT-5 (`gpt-5-mini` default).                | Teacher mode. Use to bootstrap training data with `bun run collect-training`, or as a reviewer demo path with one key. |

**`TOOL_<NAME>_MODEL`** is the distillation switch. After Distil Labs delivers the fine-tunes, pull them onto your runtime and pin:

```bash
TOOL_NARRATOR_MODEL=distil-labs/feedback-narrator-v1
TOOL_EXTRACTOR_MODEL=distil-labs/feedback-extractor-v1
TOOL_PRIORITIZER_MODEL=distil-labs/feedback-prioritizer-v1
```

No code change. Same loop. ~150× lower spend per call than running everything on Opus.

---

## TL;DR — 5 minutes to a working demo

You need: **Bun** (`curl -fsSL https://bun.sh/install | bash`) and **one** API key (Anthropic by default; OpenAI works with one config flip). No PostHog, no Ollama, no Distil Labs.

```bash
unzip slm-feedback-harness.zip && cd slm
bun install

cp .env.example .env
# In .env set ANTHROPIC_API_KEY (or OPENAI_API_KEY + LLM_PROVIDER=openai).
# Leave everything else blank.

bun test                      # 76 unit tests, ~2s. No keys needed.
bun run smoke                 # one cloud-LLM call. Prints sample output + cost.
bun run demo                  # END-TO-END on 5 bundled sample sessions:
                              #   narrate → extract → prioritize → show top findings
                              #   ~10-20 LLM calls, ~$0.10-$0.30, ~1 minute.
```

`bun run demo` forces `--engine llm` so a reviewer with one key sees the loop without needing local models. After distillation the same demo runs on the SLM engine (Ollama or whichever runtime hosts your distilled weights). `bun run demo --engine slm` exercises the SLM path against generic Qwen if you have Ollama up.

---

## Distil Labs hand-off in one command

```bash
bun run collect-training --limit 200
```

For each of the three tools, this runs the cloud LLM as the **teacher** over real cached pipeline inputs, validates each output against the tool's `outputSchema`, and writes schema-clean training pairs to `data/training/<tool>.jsonl`:

```json
{"tool":"extractor","teacher":"llm-extractor","input":{"narration":"…"},"output":{"findings":[…]}}
```

Hand the jsonl files to the Distil Labs platform. They expand the seeds into synthetic training data and ship back a fine-tuned model file per tool. Deploy them on your runtime (Ollama, vLLM, etc.) and pin via `TOOL_<NAME>_MODEL`. Done.

After distillation, run the eval to confirm the student matches the teacher:

```bash
bun run eval --sample 20
```

---

## Every script

```bash
bun run demo                                          # end-to-end on bundled samples
bun run demo --engine slm                             # same, on Ollama / OpenAI-compatible SLM
bun run ingest           --since 24h                  # pull recent PostHog events
bun run narrate          --limit 50                   # raw events → narration cache
bun run extract          --threshold 0.85             # narrations → deduped findings
bun run prioritize       --limit 50                   # rank findings
bun run report                                        # markdown rollup
bun run dashboard                                     # localhost:8787, auto-refresh 30s
bun run eval             --sample 20                  # SLM vs LLM extractor head-to-head
bun run collect-training --limit 200                  # jsonl training pairs for Distil Labs
bun run test                                          # 76 unit tests
```

---

## Quick start — local (with real PostHog data)

```bash
bun install
cp .env.example .env
# Fill ANTHROPIC_API_KEY (or OPENAI_*), POSTHOG_API_KEY, POSTHOG_PROJECT_ID.

ollama serve &              # if not already running
ollama pull qwen2.5:7b      # generic SLM placeholder
ollama pull nomic-embed-text

bun run ingest --since 24h
bun run narrate
bun run extract
bun run prioritize
bun run report              # see what came out
```

---

## Quick start — Docker

```bash
cp .env.example .env             # fill in your keys
docker compose build
docker compose up -d ollama ollama-init dashboard
docker compose run --rm harness bun run demo
open http://localhost:8787
```

GPU? Uncomment the NVIDIA `deploy` block in `docker-compose.yml`.

---

## Swap the SLM in one line

The `slm` engine is fully pluggable via `SLM_PROVIDER`:

| `SLM_PROVIDER`      | Backend                                                                                                            | Extra env                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `ollama` (default)  | Local Ollama daemon. Qwen 2.5 7B by default, or any model you `ollama pull` — including a distilled fine-tune.       | `OLLAMA_HOST`, `OLLAMA_MODEL`                                                      |
| `openai-compatible` | Any HTTP server speaking OpenAI's `/v1/responses`: vLLM, LM Studio, llama.cpp server, Groq, Together, Fireworks, a Cloudflare Worker fronting your distilled weights. | `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` (often a dummy string locally) |

Per-tool model override (`TOOL_<NAME>_MODEL`) wins over the global default — that's the pin for distilled weights.

```bash
# Generic SLM on Groq's Llama 4
SLM_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=meta-llama/llama-4-maverick-17b-128e-instruct
OPENAI_API_KEY=gsk_…
```

```bash
# Stay on Ollama, swap Qwen for a distilled fine-tune
SLM_PROVIDER=ollama
TOOL_EXTRACTOR_MODEL=distil-labs/feedback-extractor-v1
```

---

## Environment variables

Copy `.env.example` to `.env`. Common ones:

| Var                            | Why                                                      |
| ------------------------------ | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Claude when `LLM_PROVIDER=anthropic` (default)           |
| `ANTHROPIC_MODEL`              | default `claude-opus-4-7`                                |
| `OPENAI_API_KEY`               | GPT when `LLM_PROVIDER=openai`                           |
| `OPENAI_MODEL`                 | default `gpt-5-mini`                                     |
| `OPENAI_BASE_URL`              | optional: any OpenAI-compatible runtime URL              |
| `LLM_PROVIDER`                 | global `anthropic` (default) or `openai`                 |
| `TOOL_<NAME>_LLM_PROVIDER`     | per-tool override (`anthropic`/`openai`)                 |
| `SLM_PROVIDER`                 | `ollama` (default) or `openai-compatible`                |
| `TOOL_<NAME>_MODEL`            | per-tool model name for the `slm` engine — pin distilled weights here |
| `TOOL_<NAME>_ENGINE`           | force `slm` or `llm` per tool                            |
| `POSTHOG_API_KEY`              | events feed                                              |
| `POSTHOG_PROJECT_ID`           | which PostHog project                                    |
| `DRY_RUN`                      | `1` (default) — disables any external writes             |

---

## Layout

```
src/
  agents/         narrator · extractor · prioritizer
  integrations/   completer (interface) · llm (Anthropic) · openai · slm (Ollama)
                  posthog · embeddings · db (SQLite)
  orchestrator/   sessions · dedupe · metrics
  tools/          registry — tool catalog (schemas, engines, per-tool models)
                  dispatch — per-tool routing across slm | llm
  util/           config (zod) · log · cost · retry · cache · duration
scripts/          smoke · demo · ingest · narrate · extract · prioritize
                  report · dashboard · eval · collect_training
tests/            76 unit tests across 11 files
data/             findings.db · sessions/*.jsonl
                  cache/narrations.jsonl · cost.jsonl
                  report-*.md · eval-*.md
                  training/<tool>.jsonl (Distil Labs handoff)
```

---

## For a Distil Labs reviewer

1. **Run `bun run demo`.** Five PostHog-shaped sample sessions go through narrator → extractor → prioritizer. One Anthropic key, no Ollama, one transcript.
2. **Read the contracts.** [`src/tools/registry.ts`](src/tools/registry.ts) — three tools, each with explicit input + output zod schemas. That is the contract Distil Labs trains against.
3. **Inspect the training-data shape.** Run `bun run collect-training --limit 50 --dry-run` to see what we'd hand off: jsonl pairs of `{tool, teacher, input (schema-validated), output (schema-validated)}`.
4. **Try the model switch.** After delivery, pin a distilled fine-tune via `TOOL_<NAME>_MODEL=distil-labs/feedback-extractor-v1`. The `slm` engine routes that single tool to the new weights — no code change.
5. **Watch the cost line.** `bun run report` reads `data/cost.jsonl` and shows spend per agent and per model. After distillation, the LLM rows go quiet.

---

## Cost (rough)

- **Teacher mode (`--engine llm` everywhere, what `bun run demo` and `bun run collect-training` use):** ~$0.10 – $0.30 for one demo run on 5 sample sessions; a 24-hour run on a few hundred sessions lands around $0.50 – $2.00.
- **SLM mode on generic Qwen via Ollama:** $0 at inference. Quality is "OK" — placeholder until distillation.
- **SLM mode after distillation:** $0 at inference, quality matches the teacher (the intelligent-harness post claims 0.6B students beat 120B teachers by ~29 points on the target task).

Run `bun run report` after any run for the exact breakdown by agent and by model.
