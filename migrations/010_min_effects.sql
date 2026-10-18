-- "Todos en" can ask for the expected number of different wanted effects
-- ("Media", -1, the default), at least some of them (4 of 5...) or all of
-- them (0). Run once in the Neon SQL editor on the production database
-- (cauldron) BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: every world starts with -1 ("Media"); older runs keep NULL.
-- If an earlier version of this file (DEFAULT 0) was already run, also run:
--   ALTER TABLE servers ALTER COLUMN min_effects SET DEFAULT -1;
--   UPDATE servers SET min_effects = -1 WHERE min_effects = 0;

ALTER TABLE servers ADD COLUMN IF NOT EXISTS min_effects INTEGER NOT NULL DEFAULT -1;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS min_effects INTEGER;
