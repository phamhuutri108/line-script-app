-- Migration: 0008_project_soft_delete
ALTER TABLE projects ADD COLUMN deleted_at INTEGER;
