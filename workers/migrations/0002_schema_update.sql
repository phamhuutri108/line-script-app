-- Migration: 0002_schema_update
-- Updated role system + invite_tokens + google_tokens + shots columns

-- SQLite does not support ALTER COLUMN, so we recreate users with new role constraint
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'pending' CHECK (role IN ('super_admin', 'owner', 'member', 'pending')),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Migrate old 'admin' role → 'super_admin' before inserting
INSERT INTO users_new
  SELECT id, email, password_hash, name,
    CASE role WHEN 'admin' THEN 'super_admin' ELSE role END,
    created_at
  FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys = ON;

-- Invite tokens
CREATE TABLE IF NOT EXISTS invite_tokens (
  token TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Google OAuth tokens
CREATE TABLE IF NOT EXISTS google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry INTEGER NOT NULL,
  sheets_id TEXT,
  drive_folder_id TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- New columns for shots
ALTER TABLE shots ADD COLUMN storyboard_drive_id TEXT;
ALTER TABLE shots ADD COLUMN storyboard_view_url TEXT;
ALTER TABLE shots ADD COLUMN sheets_row_index INTEGER;
ALTER TABLE shots ADD COLUMN updated_at INTEGER DEFAULT (unixepoch());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invite_tokens_project ON invite_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
