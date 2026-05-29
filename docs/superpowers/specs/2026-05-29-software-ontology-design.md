# SoftwareOntology — Design Spec

**Date:** 2026-05-29
**Status:** Draft for review
**Author:** Brainstormed with Claude Code

An open-source, self-hostable alternative to Palantir Foundry, built around a
semantic **Ontology** layer. This spec captures the full vision but specifies
**Phase 1** (the production-grade vertical slice) in implementable detail.
Phases 2–4 are roadmap context, not implementation targets for the first plan.

---

## 1. Vision & positioning

Foundry's defining capability is not its pipelines or dashboards — it is the
**Ontology**: a semantic layer that maps raw datasets to business *Objects*,
*Links*, and *Actions*. SoftwareOntology rebuilds that spine as open software.

- **Target end-state:** self-hostable, single-org platform (multi-tenant-*ready*).
- **Beachhead (combined):**
  - **A — Engineering teams / dev-first & open:** OSS, git-native, clean SDK, fast time-to-value.
  - **B — Regulated / sovereign:** on-prem, air-gappable, deep audit.
- **Why both work together:** B (air-gap) is the stricter superset of A. Engineer
  for air-gap and dev-first teams get everything for free, provided every external
  dependency stays **optional and swappable**.

We do **not** compete with Foundry on feature breadth on day one. We win a sharp,
production-grade wedge (open + self-hostable + sovereign-capable) and expand.

## 2. Scope

### In scope (Phase 1 — what the first implementation plan covers)
A single production-grade vertical thread, end to end:

> A user logs in → uploads a dataset → models it as Object Types with Properties
> and Links → defines an Action with validation → runs the Action (ACID write-back)
> → browses the result in the Object Explorer and an Object detail view.

### Out of scope for Phase 1 (roadmap, §13)
Pipelines, external connectors, dataset branching, derived Functions, lineage,
the low-code app builder, dashboards, AIP/agents, automations, multi-org SaaS
activation. The architecture must **not preclude** these; it must not **build**
them yet.

### Non-goals (ever, by design)
- Mandatory cloud dependency, telemetry phone-home, or license server.
- Matching Foundry's connector catalogue or petabyte-scale Spark engine at v1.

## 3. Architecture

**Modular monolith.** All modules load in-process into one stateless server;
they communicate through the kernel's registry, not the network. One deployable,
simple transactions, easy to operate — and because modules are isolated by a
strict contract, any hot module can be extracted into its own service later
without a rewrite.

```
                 ┌─────────────────────────────────────────┐
   React UI ───▶ │  so-server (Fastify)                     │
                 │   @so/kernel  ── loads & wires modules    │
                 │   ┌────────┬────────┬─────────┬────────┐  │
                 │   │ auth   │datasets│ ontology│ actions│  │
                 │   ├────────┴────────┴─────────┴────────┤  │
                 │   │ explorer (UI+API) │ admin (UI+API)  │  │
                 │   └───────────────────────────────────┘   │
                 │   ctx: db · objectStore · query · events  │
                 └──────┬──────────────┬──────────────┬──────┘
                        │              │              │
                   Postgres        MinIO/S3        DuckDB
                 (metadata +      (datasets,     (in-process
                  write-back +     Parquet)       query engine)
                  audit)
   so-worker (same image, jobs entrypoint) ── background jobs
```

**Stack:** TypeScript end-to-end. Fastify (API host), React + TypeScript (UI),
Postgres (system-of-record: metadata, write-back, audit), object storage via the
S3 API (MinIO self-host ⇄ S3 cloud) for dataset Parquet, **DuckDB in-process** as
the analytical query engine over Parquet. Job queue via `pg-boss` (Postgres-backed)
in Phase 1.

**Monorepo** (pnpm workspaces + Turborepo):
```
packages/
  kernel/         @so/kernel        module loader, DI container, event bus, registry
  sdk/            @so/sdk           defineModule(), types, contract-test harness
  server/         @so/server        Fastify host + middleware (auth, telemetry, errors)
  worker/         @so/worker        job runner host
  ui-shell/       @so/ui-shell      React shell, UI-contribution loader, design system
  observability/  @so/observability OTel, structured logging, health
modules/
  auth/  datasets/  ontology/  actions/  explorer/  admin/
apps/
  web/            Vite React app that mounts ui-shell + module UIs
deploy/
  compose/  helm/  airgap/
```

## 4. The module framework (`@so/sdk`)

A module is a TypeScript package exporting `defineModule`:

```ts
export default defineModule({
  id: 'ontology',
  version: '0.1.0',
  dependsOn: ['datasets', 'auth'],
  contributes: {
    objectTypes,            // ontology object-type definitions
    linkTypes,              // relationship definitions
    actions,                // validated write-back operations
    functions,              // derived logic (Phase 2)
    connectors,             // data-source connectors (Phase 2)
    apiRoutes,              // Fastify plugin(s)
    ui,                     // React UI contributions (manifest)
    jobs,                   // background jobs
    migrations: './migrations',   // SQL migrations (versioned, reversible)
    permissions: ['ontology:read', 'ontology:edit'],
  },
  async onInstall(ctx) {},  // run migrations, seed
  async onStart(ctx) {},    // register into runtime registries
  async onStop(ctx) {},
})
```

**Kernel responsibilities:** discover modules → resolve `dependsOn` into a load
order (fail fast on cycles/missing deps) → run migrations → call lifecycle hooks
in order → expose contributions through typed registries.

**`ctx` (the service container)** handed to every module:
`db` (Postgres pool, transaction helper), `objectStore` (S3 client), `query`
(DuckDB session factory), `registry` (read other modules' contributions),
`events` (typed pub/sub bus), `config`, `log`, `metrics`.

**Extension-point registries:** `registry.objects`, `.links`, `.actions`,
`.functions`, `.connectors`, `.permissions`, `.ui`. Modules register on `onStart`;
consumers resolve at runtime. UI contributions are declared in a manifest the
`ui-shell` reads to lazy-load React route/panel bundles.

**Contract tests:** `@so/sdk` ships a harness that boots a module in isolation
with a fake `ctx` and asserts its contributions + lifecycle. Every module ships
contract tests; CI runs them.

## 5. Platform foundation (built through Phase 1)

| Package | Responsibility |
|---|---|
| `@so/kernel` | Module discovery, dependency resolution, DI container, event bus, registries, lifecycle orchestration |
| `@so/sdk` | `defineModule`, shared types, the contract-test harness |
| `@so/server` | Fastify host; auth/session, telemetry, error-handling, request-context middleware; mounts module `apiRoutes` |
| `@so/worker` | Loads the same modules, runs `jobs` off the `pg-boss` queue |
| `@so/ui-shell` | React app shell, navigation, auth guard, design system, dynamic loader for module UI contributions |
| `@so/observability` | OpenTelemetry traces + metrics, structured JSON logging, `/healthz` & `/readyz` |

## 6. Phase 1 modules

### `module-auth` *(deps: none)*
Users, password + session (httpOnly cookie) auth, **OIDC-ready** pluggable
provider interface (built-in provider is the default/air-gap fallback). RBAC:
roles → permissions; permission registry populated by modules. Org-scoping
primitive: `org_id` injected into request context (single seeded org in Phase 1).
Authorization middleware + a `ctx.authz.can(user, permission, resource?)` helper.
**v1 granularity:** object-type-level and dataset-level checks. Property-level
row security is *designed for* (see §7) but enforced in Phase 2.

### `module-datasets` *(deps: auth)*
- **Upload connector** (Phase 1's only connector): CSV/Parquet upload → schema
  inference → stored as Parquet in object storage under `org/{id}/datasets/{id}/`.
- **Dataset registry** in Postgres: dataset metadata, schema, version (single
  version in Phase 1; branching is Phase 2).
- **Query/preview API**: DuckDB reads the Parquet directly; returns paginated rows.

### `module-ontology` *(deps: datasets, auth)*
The core. Defines and resolves the semantic layer.
- **Object Types**: named, with typed **Properties** (string, int, float, bool,
  timestamp, enum), a designated **primary key** property, and a **mapping** to a
  backing dataset (`property ↔ dataset column`).
- **Link Types**: typed relationships between two object types. Phase 1 supports
  **many-to-one / one-to-many** via a foreign-key column; many-to-many (via a
  join dataset) is Phase 2.
- **Object Sets**: a queryable, filterable collection of one object type.
- **Resolution API** (the heart, §7): resolves object instances and links by
  querying the backing Parquet via DuckDB, **merged with the write-back overlay**.

### `module-actions` *(deps: ontology, auth)*
- **Action definitions**: typed parameters, declarative validation rules, a target
  object type, and an effect (edit existing object / create new object).
- **Write-back store** (§7): edits and new objects persist in Postgres, never
  mutating source Parquet. Applied inside a **DB transaction**; emits an
  `action.applied` event; writes an **audit record** (actor, action, params,
  before/after, timestamp). Optimistic concurrency via a per-object version.

### `module-explorer` *(deps: ontology, actions)*
React UI + a thin backend-for-frontend. **Object Explorer** (type list, faceted
filters, results table/cards, cursor pagination, export object set) and **Object
detail view** (properties, linked objects, available actions, history timeline).

### `module-admin` *(deps: all of the above)*
**Ontology manager** (create/edit object types, map properties to dataset columns,
define links, define actions), **dataset import UI**, and **user/permission admin**.

## 7. Data & resolution model (the critical design)

**Immutable foundation + operational overlay** — the key idea borrowed from Foundry.

- **Source datasets are immutable** Parquet files in object storage. Actions never
  rewrite them.
- **Write-back overlay** lives in Postgres: table `object_writeback(org_id,
  object_type, primary_key, property, value, version, updated_by, updated_at)` plus
  `object_created(...)` for net-new objects. This is the operational, ACID layer.
- **Resolution** = DuckDB query over the base Parquet **LEFT JOINed with the
  overlay** so edits and new objects appear in results. Overlay reach: Phase 1
  applies the overlay by exposing the relevant Postgres rows to DuckDB (via the
  DuckDB `postgres` scanner extension; fallback: fetch overlay deltas and apply as
  an Arrow side-table). Filters push down to DuckDB; results stream back paginated.
- **Links** resolve as DuckDB joins on the link's key column(s).
- **Performance:** ontology *metadata* (types, mappings, links) is cached in-process
  and invalidated on edit. Object queries target sub-second on Phase-1 dataset sizes
  via column pruning, predicate pushdown, and cursor pagination.

**Postgres metadata schema (highlights, all `org_id`-scoped):**
`orgs`, `users`, `roles`, `permissions`, `role_permissions`, `sessions`,
`datasets`, `dataset_columns`, `object_types`, `object_properties`,
`object_mappings`, `link_types`, `action_defs`, `object_writeback`,
`object_created`, `audit_log`. Every table carries `org_id` from day one.

## 8. Non-functional requirements (the production-grade bar)

These are **hard requirements**, verified in CI and review:

1. **Security & access** — OIDC/SAML-ready auth; RBAC (type/dataset-level in v1,
   property-level designed); every Action audited; no secrets in code/logs.
2. **Multi-tenancy-ready** — `org_id` on every row; single-org runtime now, SaaS by
   config later, no schema rewrite.
3. **Data integrity** — ACID write-back; action input validation; optimistic
   concurrency; immutable source datasets.
4. **Scale & reliability** — stateless app tier (horizontal scale behind a LB);
   pooled DuckDB sessions; `pg-boss` job backpressure; graceful shutdown.
5. **Observability** — OTel traces + metrics, structured logs, `/healthz` &
   `/readyz`, per-module metrics.
6. **Operability** — 12-factor config (env only); versioned, reversible migrations;
   documented backup/restore; zero-downtime rolling deploys.
7. **Quality engineering** — TypeScript strict end-to-end; unit + integration + e2e
   tests; module-contract tests; CI gates on lint/type/test for every change.
8. **Performance** — sub-second object queries on Phase-1 data; cursor pagination
   everywhere; ontology metadata cache.

## 9. Deployment — one architecture, three profiles

The app images are **identical** across profiles. Only backing-service endpoints
and a deploy profile change.

| Concern | Self-host (Compose) | Cloud (K8s/Helm) | Air-gapped |
|---|---|---|---|
| Orchestrator | Docker Compose | Kubernetes + Helm | K8s/Compose, offline registry |
| Postgres | container | RDS / Cloud SQL | container (HA pair) |
| Object store | MinIO | S3 / GCS | MinIO |
| Query engine | DuckDB in-process | DuckDB in-process | DuckDB in-process *(never changes)* |
| Job queue | pg-boss | pg-boss / managed Redis | pg-boss |
| Identity | built-in / local OIDC | Okta / Azure AD | on-prem IdP / built-in |
| LLM (Phase 4) | local or cloud | cloud API | local model only |
| Ingress / TLS | Caddy (auto-TLS) | ALB/Ingress + cert-manager | internal LB + org CA |
| Secrets | `.env` | cloud secrets manager | Vault / sealed secrets |

**Portability rests on:** object storage speaks the **S3 API everywhere**
(MinIO ⇄ S3 is a URL+key swap) and **Postgres is Postgres everywhere**; DuckDB is
embedded so there is no query service to deploy.

**Air-gap rules (hard requirements):** (1) zero phone-home by default; (2) every
external integration optional with a self-hosted alternative; (3) offline install
bundle (vendored images + charts + deps); (4) no runtime CDN fetches; (5) pinned,
reproducible, SBOM'd builds.

> Phase 1 ships the **self-host (Compose)** profile end-to-end. Helm and the
> air-gap bundle are scaffolded so they don't drift, completed in Phase 2.

## 10. UI

React + TypeScript, mounted by `@so/ui-shell`, which dynamically loads module UI
contributions. Phase-1 screens (see `/.superpowers/brainstorm/.../ui-mockups.html`):

1. **Object Explorer** — type list + faceted filters + results table/cards, cursor
   pagination, "export object set".
2. **Object detail** — typed properties, linked objects, available Actions,
   history/audit timeline.
3. **Ontology manager** — object-type editor with property→column mapping, link
   editor, action editor (params + validation).
4. **Dataset import** and **user/permission admin** (in `module-admin`).

Design system: a small, tokenized component library in `ui-shell` (no external
CDN; bundled fonts) to honor the air-gap rules.

## 11. Testing strategy

- **Unit** — pure logic (resolution query building, validation, RBAC checks).
- **Module-contract** — each module booted in isolation against a fake `ctx`.
- **Integration** — real Postgres + MinIO + DuckDB via testcontainers; exercise
  upload → map → resolve → action → audit.
- **E2E** — Playwright through the three UI screens against a seeded org.
- **CI gates** — typecheck, lint, unit+contract on every PR; integration+e2e on main.

## 12. Key decisions (locked)

- Modular monolith (in-process modules), not microservices.
- TypeScript end-to-end; Postgres + S3-API object store + in-process DuckDB.
- Immutable source datasets + Postgres write-back overlay.
- `org_id` everywhere (multi-tenancy-ready), single-org runtime in Phase 1.
- Air-gap-capable from day one; all external integrations optional/swappable.
- Beachhead: dev-first/open **and** sovereign/on-prem.

## 13. Roadmap beyond Phase 1

- **Phase 2 — thicken data + govern:** DB/object connectors, pipelines (SQL/TS
  transforms + DAG), dataset branching/transactions/time-travel, derived Functions,
  lineage graph, audit viewer + global search, property-level RLS, Helm + air-gap
  bundle completed.
- **Phase 3 — apps & analysis:** low-code app builder (widgets bound to object
  sets/actions), dashboards, code notebooks, shareable ontology/app templates.
- **Phase 4+ — AIP & automation:** LLM gateway (local + cloud), semantic/vector
  search over objects, agents using the ontology + functions/actions as tools,
  event-driven automations.

## 14. Risks & open questions

- **DuckDB ⇄ Postgres overlay merge** is the trickiest Phase-1 mechanism. Mitigation:
  prototype the resolution query (postgres-scanner vs Arrow side-table) as the first
  implementation step and benchmark before building UI on top.
- **Resolution performance at larger scale** (millions of rows) — acceptable to defer;
  revisit with partitioning/materialization in Phase 2.
- **Permission granularity** — confirm type/dataset-level is sufficient for Phase 1
  (property-level deferred).
- **Multi-tenant activation** — `org_id` is present everywhere; the actual SaaS
  control plane (org signup, isolation hardening, billing) is explicitly out of scope.
```
