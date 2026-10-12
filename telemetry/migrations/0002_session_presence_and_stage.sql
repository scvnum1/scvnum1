ALTER TABLE sessions ADD COLUMN current_page TEXT;
ALTER TABLE sessions ADD COLUMN current_act TEXT;
ALTER TABLE sessions ADD COLUMN current_location TEXT;

CREATE INDEX IF NOT EXISTS sessions_current_stage
  ON sessions(current_act, current_location, last_seen);
