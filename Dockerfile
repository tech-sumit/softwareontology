# syntax=docker/dockerfile:1
# SoftwareOntology app image — runs the modular-monolith server (API + built UI)
# and, with a command override, the pg-boss worker. Packages execute as TypeScript
# source via tsx (no per-package compile step in this workspace).

# ---- builder: install the workspace (incl. native duckdb) + build the web UI ----
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# Toolchain for native modules (duckdb's node binding) + TLS roots for fetches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @so/web build

# ---- runtime: carry the installed workspace, run via tsx ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV UI_DIST=/app/apps/web/dist
ENV PORT=3000
RUN corepack enable \
  && apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 3000
# Default: API + UI. The worker service overrides this with apps/web/worker.mjs.
CMD ["pnpm", "exec", "tsx", "apps/web/server.mjs"]
