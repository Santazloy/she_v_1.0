-- Add active_dates column to schedule_data table
-- This column stores fixed dates to prevent midnight auto-shift

ALTER TABLE schedule_data
ADD COLUMN IF NOT EXISTS active_dates JSONB;

-- Optionally, set a default value for existing records
UPDATE schedule_data
SET active_dates = NULL
WHERE active_dates IS NULL;