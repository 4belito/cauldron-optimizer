-- Saved progress of the "complete effects" search, one row per world.
-- Run once in the Neon SQL editor on the production database (cauldron)
-- BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: no existing table is touched.

CREATE TABLE IF NOT EXISTS complement_searches (
  username TEXT NOT NULL,
  server_number INTEGER NOT NULL,
  params JSONB NOT NULL,
  state JSONB NOT NULL,
  done BIGINT NOT NULL,
  total BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, server_number),
  FOREIGN KEY (username, server_number)
    REFERENCES servers (username, server_number)
    ON DELETE CASCADE ON UPDATE CASCADE
);
