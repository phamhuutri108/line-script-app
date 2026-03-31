-- Add name field to scene_markers for storing extracted scene header text
ALTER TABLE scene_markers ADD COLUMN name TEXT;
