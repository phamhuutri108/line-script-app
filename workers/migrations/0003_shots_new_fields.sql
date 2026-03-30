-- Migration 0003: Add missing shotlist fields to shots table
ALTER TABLE shots ADD COLUMN subjects TEXT;
ALTER TABLE shots ADD COLUMN script_time TEXT;
ALTER TABLE shots ADD COLUMN shot_type TEXT;
ALTER TABLE shots ADD COLUMN side TEXT;
