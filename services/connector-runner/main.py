"""Connector-runner: extract via Airflow provider Hooks, return rows as JSON.

POST /extract {provider, conn, query} -> {rows: [...]}
New sources: pip install apache-airflow-providers-<x> + add a dispatch branch.
"""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="connector-runner")


class ExtractReq(BaseModel):
    provider: str
    conn: str
    query: str


def _postgres_rows(conn: str, query: str):
    # Reuse Airflow's Postgres provider Hook (its connection model + impl).
    os.environ["AIRFLOW_CONN_DYNAMIC"] = conn
    from airflow.providers.postgres.hooks.postgres import PostgresHook  # type: ignore
    hook = PostgresHook(postgres_conn_id="dynamic")
    df = hook.get_pandas_df(query)
    return df.to_dict(orient="records")


@app.post("/extract")
def extract(req: ExtractReq):
    if req.provider == "postgres":
        return {"rows": _postgres_rows(req.conn, req.query)}
    raise HTTPException(status_code=400, detail=f"unsupported provider: {req.provider}")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
