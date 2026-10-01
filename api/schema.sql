-- Players are a display name and a hashed random key. No emails, no passwords, no IP addresses.
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  key_hash   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS games (
  id        INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  visitor   INTEGER NOT NULL CHECK (visitor >= 0),
  theo      INTEGER NOT NULL CHECK (theo > visitor),
  rallies   INTEGER NOT NULL CHECK (rallies >= 0),
  seconds   INTEGER NOT NULL CHECK (seconds BETWEEN 8 AND 3600),
  played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS games_by_player ON games (player_id, played_at DESC);
