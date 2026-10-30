-- How many premium ingredients each world avoids (0 to 4; the game has 4 a
-- week, the default). Run once in the Neon SQL editor on the production
-- database (cauldron) BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: every world starts with 4, as before.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS n_premium INTEGER NOT NULL DEFAULT 4;
