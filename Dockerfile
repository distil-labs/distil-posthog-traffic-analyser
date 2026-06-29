# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- runtime ----------
FROM oven/bun:1.3.14 AS runtime

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Default writable data dir for SQLite + jsonl caches + cost log.
ENV DATA_DIR=/app/data \
    LOG_LEVEL=INFO \
    DRY_RUN=1 \
    DASHBOARD_PORT=8787
RUN mkdir -p /app/data

EXPOSE 8787

# Default: print help. Override with `docker run ... bun run <script>`.
CMD ["bun", "run", "--help"]
