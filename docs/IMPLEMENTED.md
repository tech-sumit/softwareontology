# SoftwareOntology — What's Implemented

An open-source, self-hostable **Palantir Foundry alternative** built around a semantic Ontology layer. Modular monolith, TypeScript end-to-end (Fastify · React · Postgres · S3-API object store / MinIO · in-process DuckDB), with a `@so/kernel` + `@so/sdk` module framework.

**Status:** all four spec phases plus the prioritized Foundry-gap items (connectivity, compute, ontology depth, app builder, SSO, SDK) and **production-grade pipelines** (build health, data-quality gates, scheduling) are built, tested, and demoable. As of this writing: **31 plans merged, 88 unit/integration + component tests + a full E2E suite, 24 packages + the web app.** Run `pnpm test` to verify; `pnpm dev:api` + `pnpm dev:web` to demo (sign in `admin@example.com` / `admin`); `docker compose up -d --build` for the full container stack.

---

## Architecture

- **Kernel + modules.** `@so/kernel` loads modules in dependency order, owns the service container (`ctx`: `db`, `objectStore`, `query`, `registry`, `events`, `config`, `log`), exposes extension-point registries, and runs `onInstall`/`onStart`/`onStop`. Every capability is a module defined with `@so/sdk`'s `defineModule`.
- **Host.** `@so/server` (Fastify) builds the real `ctx` services, mounts each module's `apiRoutes` under `/api/<moduleId>`, serves `/healthz` + `/readyz`, parses cookies, BigInt-safe JSON, and serves the built UI (`UI_DIST`). `@so/worker` runs jobs **and cron `schedules`** on pg-boss (it drives pipeline scheduling via a per-minute `pipeline.tick`). `@so/observability` provides pino logging.
- **Resolution model (the core).** Source datasets are immutable Parquet in object storage. Object resolution merges the base Parquet (via DuckDB) with a Postgres **write-back overlay** (`object_writeback` edits + `object_created` new objects), so Actions' edits override base values. Computed Functions add columns over the resolved set.
- **Production-grade.** Org-scoped (`org_id` everywhere, multi-tenancy-ready), ACID write-back (`Db.transaction`), RBAC + property-level masking, parameterized SQL, structured logging, health probes, idempotent migrations, strict TypeScript, CI.

---

## Packages & API

Foundation: **`@so/kernel`**, **`@so/sdk`**, **`@so/query`** (DuckDB resolver), **`@so/server`**, **`@so/worker`**, **`@so/observability`**.

| Module | Capability | Key endpoints (prefixed `/api/<id>`) | Perms |
|---|---|---|---|
| `auth` | users, sessions, RBAC, **property-level RLS**, **OIDC/SSO** (Keycloak-compatible) | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /auth/oidc/login`, `GET /auth/oidc/callback`; exports `requirePermission` guard | — |
| `datasets` | CSV/Parquet upload → Parquet/MinIO + registry + preview | `POST /datasets?name=&format=`, `GET /datasets`, `GET /datasets/:id`, `GET /datasets/:id/preview` | `datasets:read/write` |
| `connectors-db` | ingest an external Postgres table → dataset | `POST /connectors-db`, `GET /connectors-db`, `POST /connectors-db/:id/sync` | `connectors:read/write` |
| `connectors-cloud` | ingest from S3 objects / REST endpoints → dataset | `POST /connectors-cloud`, `GET /connectors-cloud`, `POST /connectors-cloud/:id/sync` | `connectors:read/write` |
| `connectors-airflow` | reuse **Airflow provider Hooks** via a Python `connector-runner` sidecar → dataset | `POST /connectors-airflow`, `GET /connectors-airflow`, `POST /connectors-airflow/:id/sync` | `connectors:read/write` |
| `pipelines` | SQL transforms + **multi-step DAGs** → derived datasets; **build runs/health**, **data-quality expectations**, **cron scheduling** (via the worker), **incremental builds** (watermark + append-only parts) | `POST/GET /pipelines`, `POST /pipelines/:id/run`, `GET /pipelines/:id/runs`, `GET /pipelines/runs/:runId`, `PUT/DELETE /pipelines/:id/schedule` | `pipelines:read/write` |
| `apps` | **app builder** — store/validate widget-graph app definitions (Workshop-equivalent) | `POST/GET /apps`, `GET/PUT/DELETE /apps/:id` | `apps:read/write` |
| `ontology` | Object Types, Properties, Links, **Functions**, resolution, RLS | `POST/GET /ontology/object-types`, `GET /ontology/object-types/:n`, `GET /ontology/object-types/:n/objects`, `POST /ontology/link-types`, `POST /ontology/object-types/:n/functions`, `POST /ontology/object-types/:n/properties/:p/security` | `ontology:read/edit` |
| `actions` | validated **ACID write-back** + audit | `POST/GET /actions/definitions`, `POST /actions/:n/execute` | `actions:read/edit/execute` |
| `automations` | event-driven follow-up actions (`action.executed`) | `POST/GET /automations` | `automations:read/write` |
| `catalog` | audit-log viewer + global search | `GET /catalog/audit`, `GET /catalog/search?q=` | `catalog:read` |
| `lineage` | object-type → dataset / actions / links | `GET /lineage/object-types/:n` | `ontology:read` |
| `dashboards` | group-by aggregation over object sets | `POST /dashboards/aggregate` | `dashboards:read` |
| `aip` | LLM gateway + ask-over-ontology (echo/http providers) | `POST /aip/complete`, `POST /aip/ask` | `aip:use` |
| `admin` | user & role/permission administration | `GET/POST /admin/users`, `GET/POST /admin/roles`, `GET /admin/permissions` | `admin:users/roles` |

| `openapi` | serves a generated **OpenAPI 3.1 spec** of the platform API | `GET /openapi/spec` | — |

Developer SDK: **`@so/client`** — a typed API client generated from the OpenAPI spec (`openapi-typescript` → `openapi-fetch`). Run `pnpm gen:client` to regenerate after API changes.

Host endpoints: `GET /healthz`, `GET /readyz`, and the SPA at `/` (when `UI_DIST` set).

## Web app (`apps/web`)

Vite + React. Tabs: **Login**, **Explorer** (object-type sidebar · resolved-objects table · detail + action buttons), **Upload & model**, **Admin** (users), **Dashboards** (group-by bar chart), **Ask** (AIP), **Apps** (low-code builder: compose object-table / metric / action-button widgets → save → run against live data). API client with cookie auth. Pure components unit-tested under jsdom.

## Testing

- **Per-module integration tests** (testcontainers-free; run against the local Docker Postgres + MinIO) for every module — `pnpm test`.
- **Component tests** (jsdom) for the web app's pure components.
- **End-to-end suite** (`@so/e2e`) — boots **all 12 modules** in one server and walks the complete journey (login → upload → model → function → action → automation → dashboard → AIP → catalog → lineage → connector → pipeline → RLS → admin), the layer that proves all modules compose.

Run everything: `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test`.

## Deployment

Fully containerized — `docker compose up -d --build` (or `pnpm docker:up`) starts Postgres, MinIO, the **app** (API + built UI, all modules), and the **worker**, in dependency order; the app is at `http://localhost:3000`. Optional `--profile connectors` (Airflow connector-runner) and `--profile keycloak` (SSO). Multi-stage image runs the workspace via `tsx` with a `vite`-built UI. See [DEPLOY.md](DEPLOY.md) for services, env vars, and hardening notes.

## Deferred (roadmap → see `docs/BACKLOG.md`)

Dataset versioning/branches; LLM **agents** that choose tools + real **vector** semantic search (AIP depth, backlog #5); ML training/registry/inference (backlog #6); distributed compute + Helm/air-gap + HA/branching/OTel (scale & ops, backlog #8); app-builder richer widgets (charts/forms/layout) + action-parameter forms; `@so/ui-shell` dynamic module-UI extraction; pushdown aggregation/RLS for very large sets.
