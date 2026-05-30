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

## Building now (user: "build it")
1. **Connectivity** — reuse Airflow provider Hooks via a Python `connector-runner` sidecar (not Airflow's scheduler).
2. **Transformation/compute** — pipeline DAGs + scheduling + incremental; S3/REST connectors.
3. **Ontology depth** — link traversal, interfaces (link traversal first).
4. **Applications** — a low-code app builder (Workshop equivalent).
7. **Governance/identity** — Keycloak (OIDC/SSO) with our RBAC on top.
9. **Developer experience** — OpenAPI spec + generated typed client SDK.
