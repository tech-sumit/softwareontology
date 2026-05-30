# Deploying SoftwareOntology (containerized)

The whole platform runs in containers via Docker Compose: **Postgres**, **MinIO** (S3-API object store), the **app** (API + built web UI), the **worker** (pg-boss job runner), and an optional **connector-runner** (Airflow Hooks) and **Keycloak** (SSO).

## Quickstart

```bash
docker compose up -d --build      # or: pnpm docker:up
```

This builds the app image and starts, in dependency order: `postgres` → `minio` → `createbuckets` (one-shot) → `app` (healthy) → `worker`.

Open **http://localhost:3000** — the web UI is served by the app. Sign in with the admin credentials (defaults `admin@example.com` / `admin`; override via `ADMIN_EMAIL` / `ADMIN_PASSWORD`). The API is under `/api/*`; the OpenAPI spec is at `/api/openapi/spec`.

```bash
docker compose ps                 # service status
pnpm docker:logs                  # tail app + worker logs
docker compose down               # stop (keeps data volumes)
docker compose down -v            # stop and wipe data
```

## Services

| Service | Image | Purpose | Default profile |
|---|---|---|---|
| `postgres` | postgres:16 | metadata + write-back overlay + pg-boss | always |
| `minio` | minio/minio | S3-API object store (immutable Parquet datasets) | always |
| `createbuckets` | minio/mc | one-shot: creates the `so-datasets` bucket | always |
| `app` | built from `Dockerfile` | API + web UI, all 16 modules | always |
| `worker` | same image | pg-boss job runner (idle until a module registers jobs) | always |
| `connector-runner` | `services/connector-runner` | Airflow-Hook ingestion sidecar | `connectors` |
| `keycloak` | keycloak:26 | OIDC/SSO identity provider | `keycloak` |

Opt-in services:
```bash
docker compose --profile connectors up -d   # also build/run the Airflow connector-runner
docker compose --profile keycloak up -d      # also run Keycloak for SSO
```

## Configuration (app/worker environment)

| Var | Default (compose) | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://so:so@postgres:5432/so` | Postgres connection |
| `S3_ENDPOINT` | `minio:9000` | object-store endpoint (host:port) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `minioadmin` | object-store credentials |
| `S3_BUCKET` | `so-datasets` | dataset bucket |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `admin` | bootstrap admin (created idempotently on first boot) |
| `UI_DIST` | `/app/apps/web/dist` | built SPA directory the app serves |
| `PORT` | `3000` | API/UI port (binds `0.0.0.0`) |
| `CONNECTOR_RUNNER_URL` | `http://connector-runner:8077` | Airflow connector sidecar (used only on sync) |
| `OIDC_*` | unset | OIDC/SSO — see [IMPLEMENTED.md](IMPLEMENTED.md); point at Keycloak's realm endpoints |

## How the image works

Packages run as **TypeScript source via `tsx`** (this workspace has no per-package compile step), so the image is a multi-stage build that (1) installs the pnpm workspace — including the native **duckdb** binding — and `vite build`s the UI, then (2) runs `tsx apps/web/server.mjs` (API + UI) or `apps/web/worker.mjs` (worker). The app and worker share one image.

## Notes & production hardening

- **Data** lives in Docker volumes (`postgres`, `minio`). `down -v` wipes them.
- **DuckDB extensions**: the resolver auto-loads the `httpfs` extension from the DuckDB repo on first S3 access — the container needs outbound network on first run. For **air-gapped** installs, preload/vendor the extensions (tracked under backlog #8).
- **Worker** is part of the topology but idle until a module contributes `jobs`.
- Before exposing publicly: change the admin password, set strong S3 credentials, terminate TLS at an ingress/reverse proxy, set resource limits, and consider an external managed Postgres / object store. Helm charts, HA, and the air-gap bundle are tracked in [BACKLOG.md](BACKLOG.md) (#8).
