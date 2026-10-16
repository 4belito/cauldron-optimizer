-- "Todos" option per world: score recipes by the chance of getting the wanted
-- effects within N goblets (brews), instead of by the weights. Run once in the
-- Neon SQL editor on the production database (cauldron) BEFORE deploying the
-- code that uses it. Safe to re-run.
-- Additive only: every world starts with it off and 5 goblets; older runs
-- keep NULL in n_rounds (0: scored by the weights).

ALTER TABLE servers ADD COLUMN IF NOT EXISTS all_effects BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS n_rounds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS n_rounds INTEGER;
