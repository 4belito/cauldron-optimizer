-- How each optimizer run searched, for the stats page. Run once in the Neon
-- SQL editor on the production database (cauldron) BEFORE deploying the code
-- that uses it. Safe to re-run.
-- Additive only: older runs keep NULL in the new columns.

ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS exact_search BOOLEAN;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS exact BOOLEAN;
ALTER TABLE optimization_runs ADD COLUMN IF NOT EXISTS searched_in TEXT;
