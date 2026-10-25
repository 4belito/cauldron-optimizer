-- One row per "complete effects" search, for the stats page: who started it,
-- how far it got and when it finished. complement_searches only keeps the
-- latest progress per world, so it cannot be counted. Run once in the Neon SQL
-- editor on the production database (cauldron) BEFORE deploying the code that
-- uses it. Safe to re-run.
-- Additive only: no existing table is touched; searches from before this
-- migration are not counted.

CREATE TABLE IF NOT EXISTS complement_runs (
  -- Random id the browser gives each search (kept in its saved state)
  id TEXT PRIMARY KEY,
  user_id BIGINT,
  server_number INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL until every combination has been tried
  finished_at TIMESTAMPTZ,
  n_diplomas INTEGER NOT NULL,
  n_effects INTEGER NOT NULL,
  -- "Todos en" goblets (0: scored by the weights)
  n_rounds INTEGER NOT NULL DEFAULT 0,
  done BIGINT NOT NULL,
  total BIGINT NOT NULL,
  -- Times it was continued after a stop
  resumes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS complement_runs_started_at_idx
  ON complement_runs (started_at);
