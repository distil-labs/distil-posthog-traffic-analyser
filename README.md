# Distil PostHog Traffic Analyser

**Use Distil Labs SLMs to analyze PostHog events.** Instead of sending raw event streams to a generalist LLM (slow, expensive, fragile), three narrow specialists do the work: each one a fine-tunable small model that we train on your data and ship back for you to host.

Built directly from the two references:
- [Gaurav Vohra's LinkedIn writeup](https://www.linkedin.com/posts/gvohra_im-always-amazed-when-what-i-felt-were-throwaway-activity-7470888412242305026-iv6z) on the 7-person startup's product-feedback loop → **what to build**.
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

Each tool has an explicit input + output zod schema in `src/tools/registry.ts`. The schemas **are** the contracts we train against, so the orchestrator never has to parse free-form text.

| Tool          | Input                       | Output                                                 | Distil Labs target? |
| ------------- | --------------------------- | ------------------------------------------------------ | :-----------------: |
| `narrator`    | one PostHog session         | `{ sessionId, distinctId, narration }`                 | yes                 |
| `extractor`   | `{ narration }`             | `{ findings: [{ kind, severity, title, evidence }] }`  | yes                 |
| `prioritizer` | `{ findings: […] }`         | `{ ranked: [{ id, rank, reason }] }`                   | yes                 |

> The LinkedIn writeup describes more downstream agents (GitHub issue creation, PR coding). Those are deliberately **not** in this repo — they're application code that lives downstream of the SLM analysis. The part we own is the analysis itself.

---

## Engines

The three tools each run on one of two engines, selected per tool via env or `--engine`:

| Engine | What it is                                                                                        | When to use                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `slm`  | The model **you** host: your Distil-trained fine-tune, or a generic small model on Ollama (Qwen by default) or any OpenAI-compatible HTTP runtime (vLLM, LM Studio, Cloudflare Worker, Groq, Together, …). | **Default for every tool. The production path — no frontier API key.** |
| `llm`  | Cloud generalist. Anthropic Claude Opus **or** OpenAI GPT-5 (`gpt-5-mini` default).                | **Optional.** Teacher mode: label real data with `bun run collect-training`, or run the whole demo on a frontier model with one key. |

**`TOOL_<NAME>_MODEL`** is the distillation switch. After we deliver your fine-tunes, host them on your runtime and pin each tool:

```bash
TOOL_NARRATOR_MODEL=<your-narrator-model>
TOOL_EXTRACTOR_MODEL=<your-extractor-model>
TOOL_PRIORITIZER_MODEL=<your-prioritizer-model>
```

No code change. Same loop. ~150× lower spend per call than running everything on a frontier model.

---

## TL;DR — clone to a trained model, no frontier key

The main path runs on SLMs you own. Committed seed data (`examples/seeds/`) means you can train your tools without running a frontier teacher at all.

```bash
bun install

# 1. Send us the committed seeds. We expand each tool's seeds into synthetic
#    training data and return a fine-tuned model per tool.
#    examples/seeds/{narrator,extractor,prioritizer}.jsonl

# 2. Host the models you get back and pin them per tool in .env:
cp .env.example .env
#    TOOL_NARRATOR_MODEL=<your-narrator-model>
#    TOOL_EXTRACTOR_MODEL=<your-extractor-model>
#    TOOL_PRIORITIZER_MODEL=<your-prioritizer-model>

# 3. Run the pipeline on your models — no API key:
bun run demo                  # END-TO-END on 5 bundled sample sessions, engine=slm
                              #   narrate → extract → prioritize → show top findings
```

Want to see the loop before you distill? `ollama pull qwen2.5:7b` and run `bun run demo` against the generic placeholder. Quality is "OK" until you swap in your Distil model.

**Optional frontier path.** `bun run demo --engine llm` runs the whole pipeline on a frontier model instead (set `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` + `LLM_PROVIDER=openai`). It's the same model that labels training data, handy for seeing the pipeline without a local model, but it isn't the production path. `bun test` (76 tests) needs no keys.

---

## Getting your models: two ways

**A) Use the committed seeds (no frontier key).** `examples/seeds/` ships hand-authored, schema-valid seed pairs for all three tools. Send them to us as-is; we expand them into synthetic training data and return a fine-tuned model per tool. See [`examples/seeds/README.md`](examples/seeds/README.md).

**B) Label your own PostHog data with the teacher.** When you have real sessions and want the training data to reflect your product, run the teacher over them:

```bash
bun run collect-training --limit 200   # needs a frontier key (this is the teacher step)
```

For each tool, this runs the teacher over your cached pipeline inputs, validates each output against the tool's `outputSchema`, and writes schema-clean pairs to `data/training/<tool>.jsonl` — the same format as the committed seeds:

```json
{"tool":"extractor","teacher":"claude-opus-4-7","input":{"narration":"…"},"output":{"findings":[…]}}
```

Either way, send us the jsonl, host the models we return, and pin via `TOOL_<NAME>_MODEL`. Done.

After distillation, run the eval to confirm the student matches the teacher:

```bash
bun run eval --sample 20
```

## Measured results (models trained from the committed seeds)

We ran the full loop on this repo's own seed data: uploaded `examples/seeds/`
to the Distil Labs platform, trained one student per tool (Qwen3-0.6B for the
narrator, Qwen3-1.7B for extractor and prioritizer), converted the returned
weights to GGUF, and ran everything through Ollama on a laptop.

**Before vs after training** — same held-out test set, scored by an LLM judge
on the platform:

| Tool | Student | Untrained base | After training |
| --- | --- | --- | --- |
| narrator | Qwen3-0.6B | **0%** | **100%** |
| extractor | Qwen3-1.7B | 40% | 80% |
| prioritizer | Qwen3-1.7B | 75%* | 75%* |

\* the prioritizer judge fails an answer outright on any coverage violation;
live testing is the sharper lens: the untrained base drops or duplicates ids
on novel batches, the trained student ranked every batch we threw at it —
including adversarial near-duplicate batches — with exact coverage.

The untrained narrator base isn't just imprecise, it breaks the contract:
across our live runs it violated the 3-sentence format on roughly a third of
sessions and invented facts ("successfully logged in" on a failed
password-reset session). The trained 0.6B student held the format on 10/10
sessions, twice, citing real queries, buttons, and error codes.

**Student vs frontier teacher** (`bun run eval`, gpt-5-mini as teacher and
judge, 5 demo narrations): 3 ties, 1 student win, 1 teacher win — at
**$0.00 inference cost** for the student side; the whole three-tool demo runs
end-to-end for `Total USD: $0.000000`.

---

## Every script

```bash
bun run demo                                          # end-to-end on bundled samples (engine=slm)
bun run demo --engine llm                             # optional: run it all on the frontier teacher
bun run build-seeds                                   # regenerate examples/seeds/ from typed source
bun run ingest           --since 24h                  # pull recent PostHog events
bun run narrate          --limit 50                   # raw events → narration cache
bun run extract          --threshold 0.85             # narrations → deduped findings
bun run prioritize       --limit 50                   # rank findings
bun run report                                        # markdown rollup
bun run dashboard                                     # localhost:8787, auto-refresh 30s
bun run eval             --sample 20                  # SLM vs teacher head-to-head
bun run collect-training --limit 200                  # label your own data with the teacher (needs key)
bun run test                                          # 76 unit tests
```

---

## Quick start — local (with real PostHog data)

```bash
bun install
cp .env.example .env
# Fill POSTHOG_API_KEY, POSTHOG_PROJECT_ID.
# Pin your Distil models via TOOL_<NAME>_MODEL (the pipeline runs on the SLM engine).
# ANTHROPIC_API_KEY / OPENAI_* are only needed if you also run collect-training (the teacher).

ollama serve &              # if not already running
ollama pull qwen2.5:7b      # generic SLM placeholder until your models are pinned
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
                  training/<tool>.jsonl (training pairs you send us)
```

---

## Evaluating the harness

1. **Read the seeds.** [`examples/seeds/`](examples/seeds/) — hand-authored, schema-valid `{tool, teacher, input, output}` pairs for all three tools. This is what you train on; no frontier key needed to produce them.
2. **Read the contracts.** [`src/tools/registry.ts`](src/tools/registry.ts) — three tools, each with explicit input + output zod schemas. Those are the contracts you train against, and the seeds validate against them.
3. **Run it.** `bun run demo` runs the pipeline on the SLM engine. Pin your trained models via `TOOL_<NAME>_MODEL`, or `ollama pull qwen2.5:7b` for a generic placeholder first. `bun run demo --engine llm` runs the optional frontier teacher path with one key.
4. **Try the model switch.** Pin a fine-tune via `TOOL_EXTRACTOR_MODEL=<your-extractor-model>`. The `slm` engine routes that single tool to the new weights — no code change.
5. **See the training-data shape from real data.** `bun run collect-training --limit 50 --dry-run` shows the teacher-labeled pairs you'd generate from your own PostHog sessions (same shape as the seeds).
6. **Watch the cost line.** `bun run report` reads `data/cost.jsonl` and shows spend per agent and per model. On the SLM path the frontier rows stay at zero.

---

## Cost (rough)

- **SLM path (the default: `bun run demo`, your models or a generic Ollama model):** $0 at inference. The models run on your own hardware; cost is fixed infrastructure, not per-call.
- **SLM path after distillation:** $0 at inference, quality tracks the teacher (the intelligent-harness post reports 0.6B students beating 120B teachers by ~29 points on the target task; run `bun run eval` for your own numbers).
- **Optional teacher path (`--engine llm`, and `collect-training`):** ~$0.10 – $0.30 for one demo run on 5 sample sessions; labeling a few hundred real sessions lands around $0.50 – $2.00. You only pay this to generate training data or to run the teacher demo.

Run `bun run report` after any run for the exact breakdown by agent and by model.
