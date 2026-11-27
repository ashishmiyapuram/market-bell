import { loadCloses, marketProfiles, sessionFor } from './market-data.js';
import { evaluateCloses } from './strategy.js';

const saveObservation = `
  INSERT INTO market_observations (market, symbol, checked_at, requested_date, status, close_date, close_price)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(market, symbol) DO UPDATE SET
    checked_at = excluded.checked_at,
    requested_date = excluded.requested_date,
    status = excluded.status,
    close_date = CASE WHEN excluded.close_date >= COALESCE(market_observations.close_date, '')
      THEN excluded.close_date ELSE market_observations.close_date END,
    close_price = CASE WHEN excluded.close_date >= COALESCE(market_observations.close_date, '')
      THEN excluded.close_price ELSE market_observations.close_price END
  WHERE excluded.checked_at >= market_observations.checked_at
`;

async function scanMarket(env, market, now, fetchData) {
  const db = env.DB;
  const config = marketProfiles[market];
  const session = sessionFor(market, now);
  const checkedAt = now.toISOString();
  const { results: watchlist } = await db.prepare(`
    SELECT * FROM market_watchlist WHERE market = ? ORDER BY symbol
  `).bind(market).all();

  const observations = await Promise.all(watchlist.map(async stock => ({
    stock, result: await loadCloses(stock, session.date, env[config.secret], fetchData)
  })));

  for (const { stock, result } of observations) {
    let status = result.status;
    if (status === 'Ready') status = session.canSignal ? 'Checked' : 'Close verified · alerts run before market open';
    const statements = [db.prepare(saveObservation).bind(
      market, stock.symbol, checkedAt, session.date, status, result.close?.date ?? null,
      result.close?.price ?? null
    )];
    const signal = session.canSignal && result.prices ? evaluateCloses(result.prices) : null;
    if (signal) statements.push(...signalStatements(env, stock, config, session.date, checkedAt, signal));
    await db.batch(statements);
  }
}

function signalStatements(env, stock, config, date, now, signal) {
  const db = env.DB;
  // Both sample runs use IDs 1 and 2. Live runs use the session date followed by a market digit.
  const run = Number(date.replaceAll('-', '')) * 10 + config.code;
  const subject = signal.action + ' ' + stock.symbol + ' · ' + stock.company;
  const body = [
    stock.company + ' (' + stock.symbol + ', ' + stock.exchange + ')',
    signal.action + ' signal from the ' + date + ' close',
    'Trigger close: ' + config.currency + ' ' + (signal.close / 100).toFixed(2),
    (signal.action === 'BUY' ? 'Maximum buy price: ' : 'Minimum sell price: ') +
      config.currency + ' ' + (signal.limit / 100).toFixed(2),
    'Reference limit for the following regular session.',
    signal.reason,
    'Source: ' + config.source + ' daily prices.'
  ].join('\n');
  const emailStatus = env.RESEND_API_KEY && env.ALERT_TO && env.ALERT_FROM ? 'Pending' : 'Preview';

  return [
    db.prepare('INSERT OR IGNORE INTO runs (id, scanned_at) VALUES (?, ?)').bind(run, now),
    db.prepare(`
      INSERT OR IGNORE INTO alerts (run_id, market, symbol, company, currency, action, market_date,
        trigger_price, limit_price, reason, source, exchange)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((
        SELECT action FROM alerts WHERE market = ? AND symbol = ? AND source = ?
          AND market_date < ? ORDER BY market_date DESC LIMIT 1
      ), 'SELL') != ?
      AND NOT EXISTS (SELECT 1 FROM alerts WHERE market = ? AND symbol = ?
        AND source = ? AND market_date > ?)
    `).bind(run, stock.market, stock.symbol, stock.company, config.currency, signal.action, date,
      signal.close, signal.limit, signal.reason, config.source, stock.exchange,
      stock.market, stock.symbol, config.source, date, signal.action,
      stock.market, stock.symbol, config.source, date),
    db.prepare(`
      INSERT OR IGNORE INTO emails (alert_id, subject, body, recipient, created_at, status, send_key)
      SELECT id, ?, ?, ?, ?, ?, ? FROM alerts
      WHERE market = ? AND symbol = ? AND market_date = ? AND action = ? AND source = ?
    `).bind(subject, body, env.ALERT_TO ?? '', now, emailStatus, crypto.randomUUID(),
      stock.market, stock.symbol, date, signal.action, config.source)
  ];
}

export async function runLiveScan(env, { market, now = new Date(), fetchData = fetch } = {}) {
  const selected = market ? [market] : Object.keys(marketProfiles);
  await Promise.all(selected.map(item => scanMarket(env, item, now, fetchData)));
}

export function marketForCron(cron) {
  return Object.keys(marketProfiles).find(market => marketProfiles[market].cron === cron);
}
