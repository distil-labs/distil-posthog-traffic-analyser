# SLM+LLM Product Feedback Harness — Plan

Pipeline: PostHog events → narration → bug/gap extraction → prioritization → GitHub issues → code PRs. Humans gate prod.

**Stack**
- Runtime: Bun + TypeScript (strict)
- SLM: Qwen 2.5 (7B or 14B) via Ollama, local
- LLM: Claude Opus 4.7 via Anthropic API
- Orchestrator: plain async/await + queues
- Storage: SQLite (bun:sqlite) for findings, jsonl cache for narrations
- Integrations: PostHog API (fetch), `@octokit/rest`

**Routing rule**: mundane parsing/summarization → SLM. Judgment, structured reasoning, code → LLM.

---

## Phase 0 — Scaffold (0.5 day) — DONE
- `package.json`, `tsconfig.json` (strict), `.env.example`, `.gitignore`, `README.md`
- Deps: `@anthropic-ai/sdk`, `ollama`, `@octokit/rest`, `zod`
- Directory layout: `src/{agents,integrations,orchestrator,util}/`, `scripts/`, `data/`, `tests/`
- `src/util/{config,log,cost,retry}.ts`
- `src/integrations/{slm,llm}.ts`
- `scripts/smoke.ts`
- Ollama install + `qwen2.5:7b` pull (user step)

## Phase 1 — Data Ingest (1 day)
- PostHog client (`fetch` + bearer): `GET /api/projects/<id>/events` paginated
- Session grouping: `distinct_id` + 30-min idle window
- Output: `Session[]` JSON in `data/sessions/<date>.jsonl`
- CLI: `bun run scripts/ingest.ts --since 24h`

## Phase 2 — Agent 1: Narrator (SLM/Qwen) (1 day) — DONE
- `src/agents/narrator.ts` — Session → 3-sentence narration via SLM, deterministic prompt
- `src/util/cache.ts` — jsonl-backed `Set<sessionId>` to skip re-narrate; persists `(sessionId, narration, narratedAt)`
- `scripts/narrate.ts` — load latest sessions jsonl, narrate uncached, write to cache
- Tests: 4 narrator + 3 cache cases

## Phase 3 — Agent 2: Extractor (SLM/Qwen) (1 day) — DONE
- `src/agents/extractor.ts` — narration → `RawFinding[]` (zod) via SLM, JSON cleanup
- `src/integrations/embeddings.ts` — Ollama `nomic-embed-text` wrapper
- `src/orchestrator/dedupe.ts` — cosine, `findNearest`, jaccard fallback
- `src/integrations/db.ts` — `bun:sqlite` `findings(id, kind, severity, title, evidence, session_ids, occurrences, first_seen, last_seen, embedding)`
- `scripts/extract.ts` — cache jsonl → extract → embed → dedupe → store
- Tests: 4 cosine + 2 nearest + 3 jaccard + 7 extractor + 5 db

## Phase 4 — Agent 3: Prioritizer (LLM/Opus) (0.5 day) — DONE
- DB migration: adds `priority_rank`, `priority_reason`, `prioritized_at` columns
- `src/agents/prioritizer.ts` — findings batch → ranked list w/ reason via Opus, coverage check (missing/unknown/duplicate ids)
- DB: `unprioritized(limit)`, `setPriority(id, rank, reason)`, `clearPriorities()`
- `scripts/prioritize.ts` — load unprioritized, LLM rank, write back (`--reset`, `--dry-run`, `--limit`)
- Tests: 6 prioritizer + 5 db_priority

## Phase 5 — Agent 4: Issue Writer (LLM/Opus) (0.5 day) — DONE
- DB migration: `github_issue_number`, `github_issue_url`, `github_issued_at` + index
- `src/agents/issue_writer.ts` — finding → `IssueDraft` (title + markdown body w/ Summary/Evidence/Repro/Acceptance/Metadata sections) via Opus
- `src/integrations/github.ts` — Octokit `createIssue`, `ensureLabel` (auto-creates `auto-triage`)
- DB: `unissued(limit, maxRank)`, `setIssue(id, number, url)`
- `scripts/issue.ts` — top-N prioritized → draft → create → store. Honors `DRY_RUN`, `--skip-github`, `--max-rank`, `--label`
- Tests: 5 issue writer + 5 db_issue

## Phase 6 — Agent 5: Coder (LLM/Opus) (2 days) — DONE
- DB migration: `pr_branch`, `pr_number`, `pr_url`, `pr_state` (pending|drafted|posted|failed), `pr_created_at` + index
- `src/orchestrator/worktree.ts` — `sh`, `shOrThrow`, `withWorktree` (auto-clean), `branchNameFor`, `diffStat`, `hasUncommittedChanges`
- `src/agents/coder.ts` — subprocess `claude -p --dangerously-skip-permissions` inside worktree, extracts `<pr_description>` block
- `src/integrations/github.ts` — `createPullRequest(draft=true)`, `getDefaultBranch`, `linkIssueOnPR`, reviewer request
- DB: `needsPR(limit, maxRank)`, `setPR(id, {state, branch?, number?, url?})`
- `scripts/code.ts` — pulls needsPR → worktree → claude → commit → push → PR → store. Honors `DRY_RUN`, `--skip-push`
- New env: `TARGET_REPO_PATH`, `PR_REVIEWERS`, `CLAUDE_BIN`
- Tests: 11 coder + 5 worktree (real git) + 5 db_pr

## Phase 7 — Human Gate + Glue (0.5 day) — DONE
- All PRs `draft=true` (already enforced in Phase 6)
- `src/integrations/slack.ts` — `SlackNotifier` w/ retry + `buildPRMessage` (mrkdwn blocks)
- `scripts/code.ts` — fires Slack post after successful PR (no-op if `SLACK_WEBHOOK_URL` unset)
- `scripts/run.ts` — chains ingest → narrate → extract → prioritize → issue → code via subprocess; per-phase skip + limit flags; final run summary table + DB stats
- `SLACK_WEBHOOK_URL` env added
- Tests: 6 slack (payload + enabled gating)

## Phase 8 — Eval + Cost Dashboard (0.5 day) — DONE
- `src/orchestrator/metrics.ts` — pure: `sessionsPerDay`, `findingsPerDay`, `issuesPerDay`, `prsPerDay`, `rollupCost`, `summary`
- `scripts/report.ts` — markdown report w/ summary, cost by agent + model, daily tables, top-N findings
- `scripts/dashboard.ts` — `Bun.serve` HTML page (auto-refresh 30s) + `/json` + `/healthz` endpoints
- `scripts/eval.ts` — sample N narrations, extract w/ SLM + LLM, Opus judges, markdown table w/ winner counts
- Tests: 9 metrics (daily bucket, cost rollup, summary edge cases)

---

**Total: ~7 days.**

## Phase 9 — Distil Labs intelligent harness retrofit — DONE
Aligns the codebase with [Distil Labs' "intelligent harness" pattern](https://github.com/distil-labs/distil-self-healing-agent/blob/main/intelligent-harness.md): orchestrator coordinates, fine-tunable SLM tools handle each narrow domain task via strict JSON contracts.

- `src/integrations/completer.ts` — common `Completer` interface; both `SLMClient` and `LLMClient` satisfy it
- Agents refactored to take `Completer` instead of a concrete SLM/LLM client (`narrator`, `extractor`, `prioritizer`, `issue_writer`)
- `src/tools/registry.ts` — catalog of 5 tools with `name`, `description`, `distillable`, `defaultEngine`, `envEngineKey`, `envUrlKey`, `inputSchema`, `outputSchema`. 4 are distillable (narrator, extractor, prioritizer, issue_writer); coder stays LLM-only.
- `--engine slm|llm` flag on every distillable script; per-tool `TOOL_<NAME>_ENGINE` env overrides
- `scripts/collect_training.ts` — runs Opus as teacher over real cached inputs (sessions, narrations, findings) and writes schema-validated `(input, output)` pairs to `data/training/<tool>.jsonl` ready for Distil Labs ingestion

## Phase 13 — Corrected Distil Labs framing: training platform, not inference vendor — DONE
Re-reading the docs (intelligent-harness.md + self-healing-loop.md): Distil Labs trains and ships a model file; the customer hosts inference (Ollama, vLLM, OpenAI-compatible behind a Cloudflare Worker, anything). There is no Distil-Labs-owned inference API.

- `Engine` collapses to `"slm" | "llm"`. The fake `"distil"` engine is gone.
- `src/integrations/distil.ts` + `tests/distil.test.ts` deleted.
- `DISTIL_LABS_API_KEY`, `TOOL_<NAME>_DISTIL_URL`, and the `distil-labs/*` PRICING rows removed.
- New `envModelKey` per distillable tool: `TOOL_<NAME>_MODEL`. The `slm` engine reads it via `resolveSLMModel(tool)` and forwards to `SLMClient` (Ollama) or `OpenAIClient` (OpenAI-compatible runtime). This is the actual distillation switch — pin each tool to the fine-tune Distil Labs delivered.
- `defaultEngine` flips back to `"slm"` for the four distillable agents (the natural place once weights land).
- `buildEngine` no longer special-cases distil; it just builds whichever Completer the resolved engine maps to and lets per-tool model envs flow through.
- Scripts (narrate, extract, prioritize, issue, demo) drop `distil` from their `--engine` parsing.
- Demo transcript text updated to explain the new framing: "distillable default = slm; pin TOOL_<NAME>_MODEL once Distil Labs ships."
- README + PLAN reframed around training-platform model.
- `tests/registry.test.ts` rewritten: new defaults, `envModelKey` checks, `resolveSLMModel` cases.

## Phase 12 — Easily swappable SLMs + Distil-by-default with fallback — DONE
Two-part change: (a) the SLM runtime is now pluggable, and (b) the engine fallback chain matches the Distil Labs docs framing.

- **OPENAI_BASE_URL** added. `OpenAIClient` constructor passes it to the OpenAI SDK when set, so any OpenAI-compatible runtime (vLLM, LM Studio, llama.cpp server, Groq, Together, Fireworks, your own fine-tune) works as a drop-in. Also accepts a dummy API key for keyless local runtimes.
- **SLM_PROVIDER** env: `ollama` (default) or `openai-compatible`. `buildEngine("slm")` routes to `SLMClient` (Ollama) or `OpenAIClient` (any compatible HTTP endpoint).
- Default engine flipped: every distillable tool now has `defaultEngine: "distil"`. `resolveEngine` checks for `TOOL_<NAME>_DISTIL_URL` and silently falls back to `"slm"` when not configured — keeps the harness runnable with zero Distil Labs setup, then "lights up" tool-by-tool as URLs are added.
- `resolveEngine` also covers the explicit `TOOL_<NAME>_ENGINE=distil` case — same fallback, no surprise null URLs.
- README gets a "Swap the SLM in one line" matrix with Groq/Together/Fireworks/local-vLLM examples.
- 4 new resolver tests (`tests/registry.test.ts`): distil URL set → distil; URL unset → slm; explicit `--engine=llm` honored; empty env honors default → slm fallback.

## Phase 11 — OpenAI provider alongside Anthropic — DONE
The `llm` engine is no longer Anthropic-only. OpenAI's Responses API is wired through the same `Completer` interface so any distillable tool can route to either provider, globally or per tool.

- `openai` dep pinned to `^6.43.0` (the current latest npm release; docs verified via README + `src/resources/shared.ts`).
- `src/integrations/openai.ts` — `OpenAIClient` implementing `Completer`. Uses the **Responses API** (`client.responses.create({ model, instructions, input, max_output_tokens })`) per the v6.43 README: "The primary API for interacting with OpenAI models is the Responses API." Reads `resp.output_text`, `resp.usage.input_tokens`, `resp.usage.output_tokens`.
- `src/util/cost.ts` — new PRICING entries for `gpt-5`, `gpt-5-mini` (default), `gpt-5-nano`, `gpt-5-pro`, `gpt-5-codex`, `gpt-5.1`, `gpt-5.1-mini`, `gpt-4.1{,-mini,-nano}`, `gpt-4o{,-mini}` with public per-million-token USD rates.
- `src/util/config.ts` + `.env.example` — `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5-mini`), `LLM_PROVIDER` (`anthropic` default), `TOOL_<NAME>_LLM_PROVIDER` per tool.
- `src/tools/registry.ts` — `LLMProvider` type, `envLLMProviderKey` on every `ToolSpec`, `resolveLLMProvider(spec)` (per-tool env → global env → "anthropic"). `buildEngine(kind, spec?)` routes `"llm"` to `OpenAIClient` or `LLMClient` based on the resolved provider.
- `src/tools/dispatch.ts` — every dispatch fn now passes the tool spec to `buildEngine` so per-tool LLM provider takes effect.
- README + PLAN updated; new env vars in `.env.example`.
- 8 new tests (`tests/openai.test.ts`, 3 cases mocking the Responses HTTP API; `tests/registry.test.ts` extended with 5 cases for `resolveLLMProvider`).

## Phase 10 — Distil Labs production engine wired (Qwen out as production SLM) — DONE
Per `self-healing-loop.md` + `intelligent-harness.md`, the production SLM is **not** Qwen on Ollama; it is a per-tool fine-tuned ~0.6B model served behind a Cloudflare-Worker-style job URL. This phase makes the codebase reflect that:

- `Engine` type extended: `"slm" | "llm" | "distil"`.
- `src/integrations/distil.ts` — `DistilLabsClient`: POSTs `{tool, input}` w/ Bearer auth to the per-tool URL, validates the `output` field against the tool's `outputSchema`, records cost to the tracker, returns `{output, model, inputTokens, outputTokens}`.
- `src/tools/dispatch.ts` — `dispatchNarrator/Extractor/Prioritizer/IssueWriter`: one function per distillable tool, routes engine to `DistilLabsClient` or to the existing prompt-based agent functions.
- Scripts now call `dispatch*` and accept `--engine distil` in addition to `slm`/`llm`.
- Tool defaultEngine now `"llm"` for every distillable agent — the honest production-today value while waiting for distillation; flip to `distil` after handoff.
- `src/util/cost.ts` — adds `distil-labs/*` PRICING entries (~$0.15/M, ~150× cheaper than Opus per the intelligent-harness blog post) + fallback for unknown `distil-labs/*` model names.
- New env: `DISTIL_LABS_API_KEY`, `TOOL_NARRATOR_DISTIL_URL`, `TOOL_EXTRACTOR_DISTIL_URL`, `TOOL_PRIORITIZER_DISTIL_URL`, `TOOL_ISSUE_WRITER_DISTIL_URL`.
- `src/integrations/slm.ts` (Qwen via Ollama) explicitly documented as **dev/eval fallback**, not in the Distil Labs docs.
- 19 new tests (`tests/distil.test.ts` mocks `fetch` for round-trip; `tests/registry.test.ts` extended for `distil` engine resolution + `envUrlKey` presence).

## Bonus — Docker
- `Dockerfile` — Bun 1.3.14 base + git + `@anthropic-ai/claude-code` CLI; runtime `DATA_DIR=/app/data`, `CLAUDE_BIN=/usr/local/bin/claude`, `DRY_RUN=1`.
- `.dockerignore` — excludes `.git`, `node_modules`, `.env`, `data`, tests.
- `docker-compose.yml` — `ollama` + one-shot `ollama-init` (pulls `qwen2.5:7b` + `nomic-embed-text`) + `harness` (run scripts via `docker compose run --rm harness bun run ...`) + `dashboard` (Bun.serve on :8787) + named volumes for ollama models and harness data.

## Open decisions
- Qwen 7B (cheap, faster) vs 14B (better narration quality)
- Target repo for Agent 5: real product repo or sandbox first?
- Single PostHog project for PoC, or multi-tenant from day 1?
