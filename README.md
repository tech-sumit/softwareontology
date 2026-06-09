# SoftwareOntology

**An open-source, self-hostable alternative to Palantir Foundry** — a semantic **Ontology** layer over your data, with pipelines, mandatory-access governance, an app builder, an AI platform (semantic search + a tool-using agent), and Git-style data branching.

[![tests](https://img.shields.io/badge/tests-144%20passing-brightgreen)](#testing) [![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)

> TypeScript end-to-end · modular-monolith · Fastify · React · Postgres · S3-API object store (MinIO) · in-process DuckDB. Runs as a single `docker compose up`.

---

## What is this?

SoftwareOntology turns raw datasets into a **living object model** you can query, edit, govern, and build apps on:

- **Datasets** are immutable Parquet in object storage.
- The **Ontology** maps them to **Object Types** with typed **Properties**, **Links**, and computed **Functions**.
- **Objects** resolve by merging the immutable Parquet base with an **ACID Postgres write-back overlay** (via DuckDB), so edits made by **Actions** override base values without mutating source data.
- Everything is **org-scoped and project-scoped**, **permission-guarded**, and governed by **marking-based mandatory access control** that propagates through lineage.

It's a **modular monolith**: a small `@so/kernel` + `@so/sdk` framework loads feature **modules** (each owning its routes, migrations, and services) in dependency order. Add a capability = add a module.

## Features

| Area | What you get |
|---|---|
| **Ontology** | Object Types, Properties, Links, computed Functions, property-level RLS |
| **Resolution** | Immutable Parquet base + ACID Postgres write-back overlay, merged in-process by DuckDB |
| **Actions** | Validated ACID write-back + full audit log |
| **Pipelines** | SQL transforms + multi-step DAGs, build runs/health, data-quality expectations, cron scheduling, incremental builds |
| **Connectors** | Ingest from Postgres, S3 objects, REST endpoints, and Airflow (provider hooks via a Python sidecar) |
| **Governance** | Marking-based **mandatory access control** (clearance via roles, not bypassed by admin) that **propagates** to derived datasets — enforced in the shared resolve path |
| **Projects** | Multi-project workspaces with **membership** (owner / editor / viewer) as an access boundary |
| **Branching** | Isolate ontology edits on a **branch**, preview & diff, then merge into `main` |
| **AIP** | Embedding-based **semantic search** over objects + a **tool-using agent** that picks tools over your ontology (LLM gateway: echo / HTTP providers) |
| **App builder** | Compose widget-graph apps over your objects (Workshop-equivalent) |
| **More** | Dashboards (aggregations), Catalog (search + audit), Lineage, Admin (users/roles/permissions), Automations, SSO (OIDC, experimental), an OpenAPI 3.1 spec + a generated typed client |
| **Web UI** | A production-grade React **workspace shell** — project rail + Console, contextual help on every surface, a guided project-creation journey, and a ⎇ branch switcher |

See **[docs/IMPLEMENTED.md](./docs/IMPLEMENTED.md)** for the full capability catalogue and per-module API reference.

## Architecture

- **`@so/kernel`** — loads modules in dependency order, owns the service container (`ctx`: `db`, `objectStore`, `query`, `registry`, `events`, `config`, `log`), and the extension-point registries.
- **`@so/sdk`** — `defineModule`, shared types, concurrency-safe `applyMigrations`, and request helpers (`activeProjectId`, `activeBranch`).
- **`@so/server`** (Fastify) — builds the real `ctx`, mounts each module's routes under `/api/<moduleId>`, serves `/healthz` + `/readyz` and the built UI.
- **`@so/worker`** — runs background jobs + cron `schedules` on pg-boss (drives pipeline scheduling).
- **`@so/query`** — the DuckDB resolver that merges Parquet + the Postgres overlay (branch- and governance-aware).

**Production-grade NFRs:** multi-tenant (`org_id` everywhere), ACID write-back, RBAC + property masking, mandatory access control, parameterized SQL, structured logging, health probes, idempotent + concurrency-safe migrations, strict TypeScript, CI.

## Quickstart

### Run the whole stack with Docker

```bash
git clone <this-repo> softwareontology && cd softwareontology
cp .env.example .env            # then EDIT it — at minimum set ADMIN_PASSWORD
docker compose up -d --build    # Postgres + MinIO + app (API+UI) + worker
open http://localhost:3000      # sign in as admin@example.com / <ADMIN_PASSWORD>
```

> ⚠️ **Before exposing a deployment:** set a strong `ADMIN_PASSWORD`, set `COOKIE_SECURE=true` (serve behind TLS), and review **[SECURITY.md](./SECURITY.md)**. The default `admin` password is for local use only and the server logs a warning when it's in use.

Optional profiles: `--profile connectors` (Airflow connector runner), `--profile keycloak` (SSO). See **[docs/DEPLOY.md](./docs/DEPLOY.md)**.

### Local development

```bash
pnpm install
pnpm run infra:up        # start Postgres + MinIO (Docker)
pnpm run infra:seed      # seed demo overlay data
pnpm run dev:api         # API + modules on :3000  (loads .env)
pnpm run dev:web         # Vite dev server for the UI
```

## Testing

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```

**144 tests** — per-module integration tests (against the local Docker Postgres + MinIO), jsdom component tests for the web app, and a full end-to-end suite that boots every module in one server and walks the complete journey (login → upload → model → action → governance → branch → AIP → …).

## Project layout

```
packages/
  kernel  sdk  query  server  worker  observability   # foundation
  auth  projects  datasets  ontology  actions  admin   # feature modules
  connectors-db  connectors-cloud  connectors-airflow
  pipelines  catalog  lineage  dashboards  governance
  aip  automations  apps  openapi  client              # + typed SDK client
apps/
  web        # Vite + React workspace UI
docs/
  IMPLEMENTED.md  DEPLOY.md  BACKLOG.md  superpowers/   # specs + plans
```

## Contributing

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** — dev setup, the spec → plan → build workflow under `docs/superpowers/`, and the test-gated merge discipline.

## Security

This project advertises governance controls and takes them seriously. Report vulnerabilities per **[SECURITY.md](./SECURITY.md)**, which also lists documented known-limitations (SSO is experimental; deploy behind TLS; harden per the notes).

## License

[MIT](./LICENSE) © 2026 Sumit Agrawal and the SoftwareOntology contributors.
