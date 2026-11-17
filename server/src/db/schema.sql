CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('note', 'url')),
  title       TEXT NOT NULL,
  source_url  TEXT,
  content     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  error       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id        TEXT PRIMARY KEY,
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  embedder  TEXT NOT NULL,     -- vectors from different models are never compared
  embedding BLOB NOT NULL      -- little-endian float32[], L2-normalised
);

CREATE INDEX IF NOT EXISTS idx_chunks_item ON chunks(item_id);
