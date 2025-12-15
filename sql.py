"""
A simple wrapper for SQLite database operations imitating CS50 wrapper
as first training wheels.
"""

import sqlite3


class SQL:
    """
    A simple wrapper for SQLite database operations imitating CS50 wrapper
    as first training wheels.
    """

    def __init__(self, database: str):
        self.database = database

    def execute(self, query: str, *params) -> list[dict] | None:
        """
        Execute a SQL query and return results as a list of dictionaries.
        If the query is not a SELECT statement, return None.
        """
        with sqlite3.connect(self.database) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query, params)

            is_select = query.lstrip().upper().startswith("SELECT")
            if is_select:
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
            conn.commit()
