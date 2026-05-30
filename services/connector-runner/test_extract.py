import os
import pytest

PG = os.environ.get("DATABASE_URL", "postgresql://so:so@localhost:5432/so")


def test_postgres_extract():
    from main import _postgres_rows
    rows = _postgres_rows(PG, "SELECT 1 AS id, 'alpha' AS label")
    assert rows == [{"id": 1, "label": "alpha"}]
