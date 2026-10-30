CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('landing', 'email_click')),
  source TEXT NOT NULL,
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  PRIMARY KEY (day, event, source, utm_source, utm_medium, utm_campaign, is_test)
) WITHOUT ROWID;
