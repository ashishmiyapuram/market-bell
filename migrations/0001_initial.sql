CREATE TABLE watchlist (
  market TEXT NOT NULL CHECK (market IN ('US', 'IN')),
  symbol TEXT NOT NULL,
  company TEXT NOT NULL,
  PRIMARY KEY (market, symbol)
);

INSERT INTO watchlist VALUES
  ('US', 'MAPLE', 'Maple Systems'),
  ('IN', 'MONSOON', 'Monsoon Industries');

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  scanned_at TEXT NOT NULL
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  company TEXT NOT NULL,
  currency TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  market_date TEXT NOT NULL,
  trigger_price INTEGER NOT NULL,
  limit_price INTEGER NOT NULL,
  reason TEXT NOT NULL,
  UNIQUE (market, symbol, market_date)
);

CREATE TABLE emails (
  alert_id INTEGER PRIMARY KEY REFERENCES alerts(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Preview', 'Pending', 'Accepted', 'Failed')),
  send_key TEXT NOT NULL UNIQUE,
  accepted_at TEXT,
  provider_id TEXT
);
