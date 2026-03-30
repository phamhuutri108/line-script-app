-- Migration: 0001_initial
-- Line Script App — initial schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'pending' CHECK (role IN ('admin', 'member', 'pending')),
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  page_count INTEGER,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS script_lines (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  line_type TEXT NOT NULL CHECK (line_type IN ('solid', 'dashed')),
  x_position REAL NOT NULL,
  y_start REAL NOT NULL,
  y_end REAL NOT NULL,
  color TEXT DEFAULT '#000000',
  setup_number INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('highlight', 'note', 'drawing')),
  fabric_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  line_id TEXT REFERENCES script_lines(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  shot_number INTEGER NOT NULL,
  scene_number TEXT,
  location TEXT,
  int_ext TEXT CHECK (int_ext IN ('INT', 'EXT', 'INT/EXT')),
  day_night TEXT CHECK (day_night IN ('DAY', 'NIGHT', 'DAWN', 'DUSK')),
  description TEXT,
  dialogue TEXT,
  shot_size TEXT,
  angle TEXT,
  movement TEXT,
  lens TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
CREATE INDEX IF NOT EXISTS idx_lines_script_page ON script_lines(script_id, page_number);
CREATE INDEX IF NOT EXISTS idx_annotations_script_page ON annotations(script_id, page_number);
CREATE INDEX IF NOT EXISTS idx_shots_script ON shots(script_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
