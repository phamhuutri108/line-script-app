-- Migration 0006: Segmented lines + shot improvements

-- script_lines: support mixed straight/zigzag segments
ALTER TABLE script_lines ADD COLUMN segments_json TEXT;
-- Format: [{ "type": "straight"|"zigzag", "y_start": 0.1, "y_end": 0.3 }, ...]
-- Each segment covers a y-range (normalized 0-1) of the line.
-- Bracket marks are rendered at start, end, and each segment transition.

ALTER TABLE script_lines ADD COLUMN continues_to_next_page INTEGER DEFAULT 0;
-- 1 = line extends to next page → shows ↓ arrow instead of end bracket

ALTER TABLE script_lines ADD COLUMN continues_from_prev_page INTEGER DEFAULT 0;
-- 1 = line continues from previous page → no start bracket (shows ↑ indicator)

-- shots: user-editable notes (main description field) + page location for jump-to-line
ALTER TABLE shots ADD COLUMN user_notes TEXT;
-- The primary human-written description; 'description' becomes the auto-extracted/blurred part

ALTER TABLE shots ADD COLUMN page_number INTEGER;
-- Which PDF page this shot lives on; used for jump-to-line navigation
