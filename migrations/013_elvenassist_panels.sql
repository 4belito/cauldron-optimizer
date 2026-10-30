-- ElvenAssist per panel, and the world's Witch Points. Run once in the Neon
-- SQL editor on the production database (cauldron) BEFORE deploying the code
-- that uses them. Safe to re-run. Additive only: every panel starts enabled
-- (as before) and no Witch Points are known.
--
-- elvenassist_off: panels ElvenAssist may not fill ("effects", "premium",
--   "limits"); empty: it fills them all
-- owned_witch_points: the world's Witch Points as ElvenAssist last sent them;
--   the Witch Point slider ends there. NULL: not known

ALTER TABLE servers ADD COLUMN IF NOT EXISTS elvenassist_off JSONB NOT NULL DEFAULT '[]';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS owned_witch_points INTEGER;
