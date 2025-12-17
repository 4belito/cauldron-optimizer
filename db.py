# db.py
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row


class DB:
    def __init__(self, dsn: str):
        self.dsn = dsn

    def execute(self, query: str, *params: Any) -> Any:
        q = query.lstrip()
        is_select = q.upper().startswith("SELECT") or q.upper().startswith("WITH")

        with psycopg.connect(self.dsn, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)

                if is_select:
                    return cur.fetchall()  # list[dict]

                # If you used RETURNING, return the first column of the first row
                # (perfect for "RETURNING id")
                if "RETURNING" in q.upper():
                    row = cur.fetchone()
                    if row is None:
                        return None
                    # row is a dict; return the first value
                    return next(iter(row.values()))

                return cur.rowcount
