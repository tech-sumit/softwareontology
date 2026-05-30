# connector-runner

A thin **FastAPI sidecar** that reuses **Apache Airflow provider Hooks** for connectivity. It exposes a single extract endpoint that the platform's `@so/connectors-airflow` module calls over HTTP; the runner uses an Airflow Hook to fetch data and returns it as JSON rows, which the platform ingests as a dataset.

We do **not** run Airflow's scheduler — the platform has its own worker. This service borrows only Airflow's provider ecosystem (connection model + Hook implementations).

## Contract

```
POST /extract  { "provider": "postgres", "conn": "<connection-uri>", "query": "<sql>" }
            ->  { "rows": [ { ... }, ... ] }

GET  /healthz  -> { "status": "ok" }
```

`conn` is an Airflow connection URI (e.g. `postgresql://user:pass@host:5432/db`); it is exported as `AIRFLOW_CONN_*` and read by the provider Hook.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --port 8077
```

Then point the platform at it:

```bash
export CONNECTOR_RUNNER_URL=http://localhost:8077
```

> **Python:** Apache Airflow supports Python ≤ 3.12. Use a 3.11/3.12 venv (or the provided `Dockerfile`, which is based on `python:3.11-slim`).

## Test

```bash
DATABASE_URL=postgresql://so:so@localhost:5432/so pytest test_extract.py
```

## Adding providers

New source = `pip install apache-airflow-providers-<x>` + add a dispatch branch in `extract()` (mirroring `_postgres_rows`). For example, MySQL via `apache-airflow-providers-mysql` and `MySqlHook`.

## Notes / scale

- Rows-as-JSON over HTTP is fine for moderate volumes. For scale, a production runner writes **Parquet directly to object storage** and returns a pointer (deferred).
- **Air-gap:** vendor the provider wheels (`pip download` into a local index) and install offline.
