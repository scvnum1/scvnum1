CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 0,
  game_starts INTEGER NOT NULL DEFAULT 0,
  quizzes_completed INTEGER NOT NULL DEFAULT 0,
  locations_completed INTEGER NOT NULL DEFAULT 0,
  runtime_errors INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id),
  started_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 0,
  game_started INTEGER NOT NULL DEFAULT 0,
  quizzes_completed INTEGER NOT NULL DEFAULT 0,
  locations_completed INTEGER NOT NULL DEFAULT 0,
  runtime_errors INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id),
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'page_view',
      'game_started',
      'quiz_completed',
      'location_completed',
      'runtime_error'
    )
  ),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS telegram_notifications (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
  visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id),
  difficulty TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_attempt TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_game_start_per_session
  ON events(session_id, event_type)
  WHERE event_type = 'game_started';

CREATE INDEX IF NOT EXISTS events_created_at
  ON events(created_at);

CREATE INDEX IF NOT EXISTS events_visitor_created_at
  ON events(visitor_id, created_at);

CREATE INDEX IF NOT EXISTS sessions_last_seen
  ON sessions(last_seen);

CREATE INDEX IF NOT EXISTS telegram_notifications_status
  ON telegram_notifications(status, created_at);
