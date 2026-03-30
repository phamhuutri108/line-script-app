-- Migration: 0005_scene_markers
-- Scene markers for line script — each marker anchors a scene on a page

CREATE TABLE IF NOT EXISTS scene_markers (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  y_position REAL NOT NULL,
  x_offset REAL DEFAULT 0.0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scene_markers_script_page ON scene_markers(script_id, page_number);
