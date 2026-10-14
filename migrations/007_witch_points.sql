-- Witch Point limit of the search and the school's level (its discount),
-- saved per world; the limit is also logged with each optimizer run. Run once in the Neon SQL editor on the production database
-- (cauldron) BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: NULL means no limit (or, for older runs, not recorded), and
-- for the level, never saved.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS max_witch_points INTEGER;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS wonder_level INTEGER;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS max_witch_points INTEGER;
