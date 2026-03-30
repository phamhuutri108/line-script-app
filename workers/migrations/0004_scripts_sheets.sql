-- Migration 0004: Add Google Sheets fields to scripts table (sheet per script)
ALTER TABLE scripts ADD COLUMN sheets_id TEXT;
ALTER TABLE scripts ADD COLUMN sheets_url TEXT;
