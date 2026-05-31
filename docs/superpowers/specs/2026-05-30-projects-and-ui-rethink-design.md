# Projects + Complete UI Rethink — Design Spec

**Status:** approved 2026-05-30.

## Goal
Add a **Projects** layer (multiple projects per account/org) and rethink the web UI around a **left-sidebar + project-switcher** shell that surfaces **all** platform capabilities (pipelines/DAGs, connectors, API & SDK, lineage, catalog, governance, automations) — not just today's subset (Explorer, Upload&model, Admin, Dashboards, Ask, Apps, Governance). The backend for all of these already exists and is tested; this is primarily a scoping + UI-surfacing effort.

## Confirmed decisions
- **Shared ontology.** The semantic layer — object types, links, actions, functions — is **org-wide and shared across projects**. The "build artifacts" — datasets, pipelines, connectors, apps, automations — are **project-scoped**.
- **Navigation:** left sidebar grouping all surfaces + a top-bar **project switcher**.

## Projects model
- New **`@so/projects`** module: `projects(id, org_id, name, created_at)`. Bootstrap a `project_default` row named **"Default"** on install.
- **Project-scoped** resources gain `project_id text NOT NULL DEFAULT 'project_default'`: `datasets`, `pipelines` (+ `pipeline_runs`), `db_connectors`, `cloud_connectors`, `airflow_connectors`, `apps`, `automations`.
- **Active project** travels on requests via an **`X-Project`** header (defaults to `project_default` when absent). Scoped `list`/`get` queries filter by `(org_id, project_id)`; `create` stamps the active `project_id`.
- **Migration / backward-compat:** existing rows default to `project_default` (zero data loss). Requests without the header operate in Default, so the **existing test suite and current behaviour are unaffected**.
- **Shared / org-wide** (no `project_id`): ontology (object_types/link_types/actions/functions), governance markings, catalog, lineage, AIP, openapi, admin (users/roles).
- Object types stay **shared** but are backed by project-scoped datasets. The Explorer's default view is shared; **filtering the Explorer to object types whose backing dataset is in the active project** is a refinement within the Ontology-surface plan.

## UI / information architecture
- **Shell:** top bar (logo · **Project switcher** + "New project" · user · sign out) + **left sidebar** + main panel.
- **Sidebar groups:**
  - **PROJECT** *(scoped to the active project):* Data · Pipelines · Connectors · Apps · Automations
  - **PLATFORM** *(shared):* Ontology/Explorer · Lineage · Catalog · Governance · API & SDK · Ask · Admin
- **New surfaces to build** (backend exists, no UI today): **Data** browser (datasets list/preview/upload) · **Pipelines** (DAG builder + runs/build-health + schedule + data-quality expectations) · **Connectors** (create + sync, all four kinds) · **Lineage** (object-type → dataset/actions/links view) · **Catalog** (audit log + global search) · **API & SDK** (OpenAPI endpoint browser + SDK download/usage). **Existing views move into the shell:** Explorer, Apps, Dashboards, Ask, Admin, Governance, Upload&model.

## Decomposition (each: plan → branch → subagent → verify gated-green → merge)
1. **`@so/projects`** — table + Default bootstrap + CRUD API + active-project helper (`X-Project` → id).
2. **Project-scope datasets** — the pattern-setter (migration + scoped queries + header threading).
3. **Project-scope the rest** — pipelines, connectors (db/cloud/airflow), apps, automations.
4. **New UI shell** — sidebar + project switcher + routing; migrate existing views in.
5. **Surface UIs** (one plan each): Pipelines · Connectors · Data · Lineage · Catalog · API & SDK.

## Testing
- Each backend plan: integration test for **project isolation** (resource in A not visible in B) + **backward-compat** (no header ⇒ Default).
- UI: pure components jsdom-tested; the `@so/e2e` journey extended for project scoping; **live browser verification** at the end.
- The full suite stays green throughout; **merges are gated on `typecheck` + `lint` + `test` all exiting 0**.

## Deferred (not in this effort)
- Per-project **access control** (who can see/edit which project) — projects are org-visible for now; ACLs later.
- Cross-project resource moves; project archival/delete cascades; project-level quotas.
- Surfacing markings inline in the Data/Explorer views (governance has its own tab).
