# Backlog

Everything not yet built, organized by **strategic tier** (the gap to a real Palantir Foundry competitor) and **feature-level deferrals** (collected from each plan's self-review). See [IMPLEMENTED.md](IMPLEMENTED.md) for what exists.

> **Status:** the spine + the prioritized gap items + production-grade pipelines are done (31 plans, 89 tests, containerized). The items below are the remaining distance to Foundry.

---

## ✅ Delivered (was on this backlog)
- **Connectivity** — `@so/connectors-cloud` (S3/REST) + `@so/connectors-airflow` (Airflow Hook sidecar).
- **Transformation/compute** — multi-step DAGs **+ full pipeline maturity: build health, data-quality expectations, cron scheduling, incremental builds**.
- **Ontology depth** — link traversal / linked-object resolution.
- **Applications** — `@so/apps` backend + Workshop-like builder/runtime UI.
- **Governance/identity** — OIDC/SSO (Keycloak-compatible) with RBAC on top.
- **Developer experience** — OpenAPI spec + generated typed SDK.
- **Ops** — full container stack (app + worker + connector-runner); cold-DB migration race fixed (`applyMigrations`).

---

## Tier 1 — table-stakes for "real" (biggest gaps)

### A. Scale-out compute
Single-node in-process DuckDB is a hard ceiling (~10s–100s GB). Need a distributed/pushdown engine (Trino / ClickHouse / Spark) + dataset partitioning, with the resolver pushing filters/aggregations down instead of pulling rows.

### B. Governance & lineage depth *(recommended next; sovereign wedge)*
- **Marking/classification-based access control** that **propagates through lineage** (a derived dataset inherits its sources' restrictions automatically).
- **Column-level lineage** + impact analysis.
- Purpose-based access, full audit/provenance for compliance.
- Query-level (pushdown) RLS; row-level (predicate) security; masking in `resolveObjects` for non-HTTP callers; a security-admin UI.

### C. Enterprise ops & deployment
- Helm chart + **offline/air-gap install bundle** (vendored images/charts/DuckDB extensions).
- HA/DR, backup/restore, resource quotas, upgrade paths.
- Multi-tenant control plane (org signup / isolation / billing).
- OpenTelemetry exporters + APM; usage analytics; compliance certs (FedRAMP/IL5).
- Image slimming (currently ships full workspace + tsx).

---

## Tier 2 — Foundry's sticky differentiators

### D. Branching & versioning ("git for data")
Branch datasets / ontology / pipelines; propose → review → merge; dataset versioning (also unlocks true append-only compaction + multi-input incremental).

### E. AIP / AI depth
Tool-calling **agents** that invoke ontology Actions/Functions; **vector / semantic search** over objects (pgvector); a visual LLM-workflow builder (AIP-Logic); agent **evals**; streaming responses; multi-provider routing + auth headers; prompt templates; token budgeting.

### F. Workshop / application depth
Richer widgets (charts, forms, filters, markdown); layout/grid positioning; variables + cross-widget events; drill-downs; **action-parameter forms** (run-mode actions currently submit `{}`); templates; publishing/versioning; per-widget permissions.

---

## Tier 3 — breadth that widens the moat
- **ML lifecycle** — training jobs, model registry + versioning, deployment + live inference, model outputs → ontology derived properties, modeling objectives.
- **More data modalities** — geospatial, time-series, media (image/video/audio), documents, streaming.
- **More analytical surfaces** — no-code analytics (Contour), exploratory analysis (Quiver), docs/notebooks (Notepad), Map, knowledge-graph viz.
- **Connector breadth & enterprise sync** — SAP/Salesforce/etc., CDC, schema evolution, encrypted secrets, agent-based on-prem sync.

---

## Feature-level deferrals (from per-plan self-reviews)

**Ontology** — many-to-many links (join dataset); reverse (one-to-many) traversal; link traversal inside the resolver projection + in the UI; **interfaces**; function expressions referencing links/aggregations; a functions UI; filter/sort on computed columns (needs a wrapping subquery).

**Actions / Automations** — cycle/loop guarding; conditional triggers; derived (not fixed) edits; retries/dead-letter; automation run history.

**Pipelines** — cross-pipeline DAG dependencies; multi-input incremental; expectations evaluated on incremental deltas + more check types (regex / range / accepted-values / referential) + warn-vs-fail severity + a quarantine table + per-run expectation results; part **compaction** (many small parts); **reset/full-refresh** endpoint; catch-up/backfill for long scheduler outages; per-pipeline timezones; schedule overlap locking (skip if a prior run is still going); run cancellation + log capture + retry/backfill; surface watermark/next-run in the UI.

**Lineage** — column-level lineage; pipeline/connector → output-dataset provenance edges; full graph traversal/visualization; dataset-direction lineage.

**Dashboards** — sum/avg/min/max metrics; multi-dimension group-by; saved dashboards; chart types beyond bars; pushdown aggregation for large sets.

**Connectors (cloud)** — auth headers/secrets for REST; pagination; S3 across buckets/credentials; streaming; JSON schema typing.
**Connectors (Airflow)** — Parquet-direct extraction at scale; more providers wired; runner auth; encrypted secrets for `conn`; scheduled syncs via the worker.

**Auth / OIDC** — ID-token JWT (JWKS) signature verification for public clients; state/PKCE/nonce checks; Keycloak group → role mapping; logout federation; realm/client provisioning automation.

**SDK / OpenAPI** — full endpoint coverage in the spec; auto-generate the spec from route schemas; Swagger-UI page; publish the SDK to a registry.

**Testing / ops** — Playwright browser E2E (live UI checks are currently manual); load/perf testing; multi-org E2E.
