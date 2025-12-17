import sqlite3


class SQL:
    def __init__(self, database: str):
        self.database = database

    def execute(self, query: str, *params):

        with sqlite3.connect(self.database) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            cur.execute(query, params)

            is_select = query.lstrip().upper().startswith("SELECT")
            if is_select:
                return [dict(r) for r in cur.fetchall()]

            # for INSERT/UPDATE/DELETE
            if query.lstrip().upper().startswith("INSERT"):
                return cur.lastrowid
            return cur.rowcount
