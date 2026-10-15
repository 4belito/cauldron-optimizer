-- New worlds start with a search depth of 100 (was 50). "Óptima" stays on by
-- default, so the depth only matters once the player turns it off. Existing
-- worlds keep their saved depth. Run once in the Neon SQL editor on the
-- production database (cauldron). Safe to re-run.

ALTER TABLE servers ALTER COLUMN search_depth SET DEFAULT 100;
ALTER TABLE user_settings ALTER COLUMN search_depth SET DEFAULT 100;
