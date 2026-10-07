-- Multiple servers (game worlds) per user.
-- Run once in the Neon SQL editor on the production database (cauldron)
-- BEFORE deploying the code that uses it. Safe to re-run.
-- Additive only: existing user_settings values are left untouched.

BEGIN;

-- One row per (username, server number), each with its own search settings
CREATE TABLE IF NOT EXISTS servers (
  username TEXT NOT NULL
    REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
  server_number INTEGER NOT NULL CHECK (server_number >= 1),
  effect_weights JSONB NOT NULL DEFAULT '[0,0,0,0]'::jsonb,
  excluded_effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  premium_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_ingredients INTEGER NOT NULL DEFAULT 25,
  max_effects INTEGER NOT NULL DEFAULT 100,
  search_depth INTEGER NOT NULL DEFAULT 50,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, server_number)
);

-- How many servers each user plays on, and which one is selected
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS n_servers INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS active_server INTEGER NOT NULL DEFAULT 1;

-- Each existing user's current settings become their server 1
INSERT INTO servers (
  username, server_number, effect_weights, excluded_effects,
  max_ingredients, max_effects, search_depth, updated_at
)
SELECT
  u.username, 1, s.effect_weights, s.excluded_effects,
  s.max_ingredients, s.max_effects, s.search_depth, s.updated_at
FROM user_settings s
JOIN users u ON u.id = s.user_id
ON CONFLICT (username, server_number) DO NOTHING;

COMMIT;
