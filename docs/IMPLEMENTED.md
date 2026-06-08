# SoftwareOntology — What's Implemented

An open-source, self-hostable **Palantir Foundry alternative** built around a semantic Ontology layer. Modular monolith, TypeScript end-to-end (Fastify · React · Postgres · S3-API object store / MinIO · in-process DuckDB), with a `@so/kernel` + `@so/sdk` module framework.

**Status:** all four spec phases plus the prioritized Foundry-gap items (connectivity, compute, ontology depth, app builder, SSO, SDK) and **production-grade pipelines** (build health, data-quality gates, scheduling) are built, tested, and demoable. As of this writing: **53 plans merged, 122 unit/integration + component tests + a full E2E suite, 26 packages + the web app.** The web UI is a production-grade Foundry-style **workspace shell** — a project-avatar rail + ⌂ Console, a context sidebar, a slim breadcrumb/**working-search** top bar, and a rich project Home — that opens *inside a project* and keeps shared assets on the Console. **Every backend capability is wired into the UI** (ontology modeling incl. links/functions/property-security, object browsing + run-actions, connectors, pipelines/DAGs, admin roles/permissions, governance, API & SDK), plus SSO sign-in, a **guided project-creation journey** (modal → empty-project "Get started" guide), and a **contextual how-to help panel on every surface**. Run `pnpm test` to verify; `pnpm dev:api` + `pnpm dev:web` to demo (sign in `admin@example.com` / `admin`); `docker compose up -d --build` for the full container stack.

---

## Architecture

- **Kernel + modules.** `@so/kernel` loads modules in dependency order, owns the service container (`ctx`: `db`, `objectStore`, `query`, `registry`, `events`, `config`, `log`), exposes extension-point registries, and runs `onInstall`/`onStart`/`onStop`. Every capability is a module defined with `@so/sdk`'s `defineModule`.
- **Host.** `@so/server` (Fastify) builds the real `ctx` services, mounts each module's `apiRoutes` under `/api/<moduleId>`, serves `/healthz` + `/readyz`, parses cookies, BigInt-safe JSON, and serves the built UI (`UI_DIST`). `@so/worker` runs jobs **and cron `schedules`** on pg-boss (it drives pipeline scheduling via a per-minute `pipeline.tick`). `@so/observability` provides pino logging.
- **Resolution model (the core).** Source datasets are immutable Parquet in object storage. Object resolution merges the base Parquet (via DuckDB) with a Postgres **write-back overlay** (`object_writeback` edits + `object_created` new objects), so Actions' edits override base values. Computed Functions add columns over the resolved set.
- **Production-grade.** Org-scoped (`org_id` everywhere, multi-tenancy-ready), ACID write-back (`Db.transaction`), RBAC + property-level masking, **marking-based mandatory access control that propagates through lineage** (derived datasets inherit source markings — enforced on dataset preview + ontology resolution via generic `datasetAccessPolicies` / `datasetDerivationHooks` extension slots), parameterized SQL, structured logging, health probes, idempotent migrations (concurrency-safe `applyMigrations`), strict TypeScript, CI.

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
| `projects` | **multi-project workspaces** under an org; project-scoped resources via an `X-Project` header (shared ontology); **lifecycle** — rename/describe + archive/restore (Default protected) | `POST/GET /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `POST /projects/:id/archive`, `POST /projects/:id/restore`, `GET /projects/archived` | `projects:read/write` |
| `governance` | **markings + mandatory access control** (clearance via roles, not bypassed by `*`); **propagation** (derived datasets inherit source markings) | `POST/GET /governance/markings`, `POST /governance/markings/:id/datasets/:dsId`, `POST /governance/markings/:id/roles/:roleId`, `GET /governance/datasets/:id/markings`, `GET /governance/me/clearances` | `governance:read/manage` |

| `openapi` | serves a generated **OpenAPI 3.1 spec** of the platform API | `GET /openapi/spec` | — |

Developer SDK: **`@so/client`** — a typed API client generated from the OpenAPI spec (`openapi-typescript` → `openapi-fetch`). Run `pnpm gen:client` to regenerate after API changes.

Host endpoints: `GET /healthz`, `GET /readyz`, and the SPA at `/` (when `UI_DIST` set).

## Web app (`apps/web`)

Vite + React, a **workspace shell** ("Layout A hybrid"): a far-left **rail** (logo · ⌂ Console · a colored avatar per project · ＋ New · user), a **context sidebar**, a slim **top bar** (breadcrumb · global search · sign-out), and the main panel. The app **opens inside a project** (the default); the API client sends the active project as an `X-Project` header on every request. ＋ New launches a **guided project-creation modal** (name + optional description); a brand-new project's Overview shows a **"Get started" guide** (upload & model → pipeline → connector → app) until it has content. Each project has a **Settings** surface to rename / edit its description / **archive** it (the Console lists archived projects with **Restore**; the Default project is protected). Action feedback uses a global **toast**. Every surface carries a collapsible **"How to use this" help panel** (concrete how-to steps, content centralized in `apps/web/src/help.ts`). Two contexts:

- **Project context** *(scoped)* — sidebar: **Overview** (rich Home: KPI cards · recent-pipeline-runs activity feed · recent datasets) · **Data** (list + preview) · **Upload & model** · **Pipelines** (single-SQL or multi-step DAG + data-quality expectations · run · build-health runs · cron schedule) · **Connectors** (DB/S3/REST/Airflow create + sync) · **Apps** (low-code widget builder → run) · **Automations**.
- **Console context** *(shared)* — a dashboard of **project cards** + **platform tiles**, with a sidebar: **Ontology Explorer** (full modeling — properties · computed functions · links · property-level security · create object types from datasets) · **Object Explorer** (browse a type's objects → detail with linked objects + **run actions** = ACID write-back) · **Lineage · Catalog** (with working global search) · **Dashboards · Governance · API & SDK · Ask · Admin** (users · roles · permissions). Shared assets never appear inside a project.

Premium design system (dark rail/sidebar, light content, cards/tiles/badges/stat-KPIs). Pure components unit-tested under jsdom (LoginForm, ObjectsTable, BarList, UsersTable, AppRuntime, MarkingsTable, WorkspaceRail, ContextSidebar, TopBar, RunsTable, ConnectorList, EndpointList). Served by the API via `UI_DIST`; all modules (incl. `projects`) are wired into the dev server (`dev-server.mjs` imports the shared `modules.mjs`) + the container.

## Testing

- **Per-module integration tests** (testcontainers-free; run against the local Docker Postgres + MinIO) for every module — `pnpm test`.
- **Component tests** (jsdom) for the web app's pure components.
- **End-to-end suite** (`@so/e2e`) — boots **all 12 modules** in one server and walks the complete journey (login → upload → model → function → action → automation → dashboard → AIP → catalog → lineage → connector → pipeline → RLS → admin), the layer that proves all modules compose.

Run everything: `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test`.

## Deployment

Fully containerized — `docker compose up -d --build` (or `pnpm docker:up`) starts Postgres, MinIO, the **app** (API + built UI, all modules), and the **worker**, in dependency order; the app is at `http://localhost:3000`. Optional `--profile connectors` (Airflow connector-runner) and `--profile keycloak` (SSO). Multi-stage image runs the workspace via `tsx` with a `vite`-built UI. See [DEPLOY.md](DEPLOY.md) for services, env vars, and hardening notes.

## Deferred (roadmap → see `docs/BACKLOG.md`)

Dataset versioning/branches; LLM **agents** that choose tools + real **vector** semantic search (AIP depth, backlog #5); ML training/registry/inference (backlog #6); distributed compute + Helm/air-gap + HA/branching/OTel (scale & ops, backlog #8); app-builder richer widgets (charts/forms/layout) + action-parameter forms; `@so/ui-shell` dynamic module-UI extraction; pushdown aggregation/RLS for very large sets.
