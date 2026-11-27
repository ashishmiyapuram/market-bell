ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'Sample data';
ALTER TABLE alerts ADD COLUMN exchange TEXT;

CREATE TABLE market_watchlist (
  market TEXT NOT NULL CHECK (market IN ('US', 'IN')),
  symbol TEXT NOT NULL,
  company TEXT NOT NULL,
  exchange TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  PRIMARY KEY (market, symbol)
);

INSERT INTO market_watchlist VALUES
  ('US', 'AAPL', 'Apple', 'NASDAQ', 'AAPL'),
  ('US', 'MSFT', 'Microsoft', 'NASDAQ', 'MSFT'),
  ('IN', 'ICICIBANK', 'ICICI Bank', 'NSE', 'NSE_EQ|INE090A01021'),
  ('IN', 'RELIANCE', 'Reliance Industries', 'NSE', 'NSE_EQ|INE002A01018');

CREATE TABLE market_observations (
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  status TEXT NOT NULL,
  close_date TEXT,
  close_price INTEGER,
  PRIMARY KEY (market, symbol),
  FOREIGN KEY (market, symbol) REFERENCES market_watchlist(market, symbol)
);
