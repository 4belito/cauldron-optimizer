-- "Todos en" can ask for at least some of the wanted effects (4 of 5...)
-- instead of all of them. Run once in the Neon SQL editor on the production
-- database (cauldron) BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: every world starts with 0 (all of them); older runs keep
-- NULL.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS min_effects INTEGER NOT NULL DEFAULT 0;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS min_effects INTEGER;
