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
-- Keyset pagination order for GET /items, and the status filter used while polling.
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- Monotonic revision of everything the vector search reads. Triggers bump it on ANY change (including
-- cascade deletes), so the in-memory vector cache can never serve stale data regardless of which code
-- path wrote to the database.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('vector_revision', 0);

CREATE TRIGGER IF NOT EXISTS trg_chunks_insert AFTER INSERT ON chunks
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'vector_revision'; END;

CREATE TRIGGER IF NOT EXISTS trg_chunks_delete AFTER DELETE ON chunks
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'vector_revision'; END;

CREATE TRIGGER IF NOT EXISTS trg_items_status AFTER UPDATE OF status ON items
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'vector_revision'; END;
