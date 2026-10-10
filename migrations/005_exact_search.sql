-- "Optimal solution" option per world: search every recipe instead of the
-- search depth. Run once in the Neon SQL editor on the production database
-- (cauldron) BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: every world, existing or new, starts with it on (true).

ALTER TABLE servers ADD COLUMN IF NOT EXISTS exact_search BOOLEAN NOT NULL DEFAULT TRUE;
