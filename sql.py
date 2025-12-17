import sqlite3


class SQL:
    def __init__(self, database: str):
        self.database = database

    def execute(self, query: str, *params):
        """
        - SELECT  -> returns list[dict]
        - INSERT  -> returns lastrowid (int)
        - UPDATE/DELETE -> returns rowcount (int)
        """
        with sqlite3.connect(self.database) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            try:
                cur.execute(query, params)
            except sqlite3.IntegrityError:
                # let the caller decide what to do (duplicate username, FK fail, etc.)
                raise

            is_select = query.lstrip().upper().startswith("SELECT")
            if is_select:
                return [dict(r) for r in cur.fetchall()]

            # for INSERT/UPDATE/DELETE
            if query.lstrip().upper().startswith("INSERT"):
                return cur.lastrowid
            return cur.rowcount
