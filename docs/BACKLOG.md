# Backlog — deferred Foundry-gap items

Explicitly deferred (user decision: "fine for now, add in backlog"). Not gaps in the current plans — future phases.

## 5. AIP / AI — depth
Current: LLM gateway (echo/http) + ask-over-ontology. Remaining:
- Tool-calling **agents** that invoke ontology Actions/Functions as tools.
- Visual LLM-workflow builder (AIP-Logic equivalent).
- Real **embeddings + vector semantic search** over objects (e.g. pgvector).
- Agent **evals**, streaming responses, multi-provider routing + auth headers.

## 6. ML / Modeling — not started
- Model training jobs, **model registry**, versioning.
- Model **deployment + live inference endpoints**.
- Modeling objectives; integrate model outputs back into the ontology as derived properties.

## 8. Scale, deployment & ops — beyond single node
- **Distributed compute** for big data: swap/augment in-process DuckDB with Spark/Trino/ClickHouse for petabyte-scale resolution + aggregation.
- **Helm chart + offline/air-gap install bundle** (images + charts + vendored deps).
- HA/DR, resource quotas, multi-tenant control plane (org signup/isolation/billing).
- Platform-wide **branching/merging** (data + ontology + code, not just git).
- OpenTelemetry exporters + APM; usage analytics; compliance certifications (FedRAMP/IL5).

---

## Delivered (user: "build it") — all merged & tested ✅
1. **Connectivity** — `@so/connectors-airflow` drives a Python `connector-runner` sidecar reusing Airflow provider Hooks (Plan 25). ✅
2. **Transformation/compute** — pipeline multi-step DAGs (Plan 22) + S3/REST connectors `@so/connectors-cloud` (Plan 23). ✅ *(remaining: scheduling + incremental builds → backlog)*
3. **Ontology depth** — link traversal / linked-object resolution (Plan 21). ✅ *(remaining: interfaces → backlog)*
4. **Applications** — `@so/apps` backend (Plan 27) + builder/runtime UI (Plan 28). ✅ *(remaining: richer widgets, layout, action-param forms → backlog)*
7. **Governance/identity** — OIDC/SSO in `@so/auth`, Keycloak-compatible, RBAC on top (Plan 26). ✅
9. **Developer experience** — `@so/openapi` spec + generated `@so/client` typed SDK (Plan 24). ✅
