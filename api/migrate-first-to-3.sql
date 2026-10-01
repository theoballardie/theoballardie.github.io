-- Games are now first to three. SQLite can't change a CHECK in place, so rebuild the table.
CREATE TABLE games_new (
  id        INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  visitor   INTEGER NOT NULL CHECK (visitor >= 0),
  theo      INTEGER NOT NULL CHECK (theo > visitor),
  rallies   INTEGER NOT NULL CHECK (rallies >= 0),
  seconds   INTEGER NOT NULL CHECK (seconds BETWEEN 8 AND 3600),
  played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO games_new SELECT * FROM games;
DROP TABLE games;
ALTER TABLE games_new RENAME TO games;
CREATE INDEX IF NOT EXISTS games_by_player ON games (player_id, played_at DESC);
