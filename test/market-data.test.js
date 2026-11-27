import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/local-db.js';
import { loadCloses, sessionFor } from '../src/market-data.js';
import { marketForCron, runLiveScan } from '../src/live-scan.js';
import { runDemo } from '../src/worker.js';

const us = { market: 'US', exchange: 'NASDAQ', provider_key: 'AAPL' };

function candles(end, direction = 'up') {
  const bars = [];
  const day = new Date(end + 'T00:00:00Z');
  while (bars.length < 53) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const close = bars.length === 0 ? (direction === 'up' ? 101 : 98) :
        bars.length === 1 && direction === 'down' ? 101 : 100;
      bars.push({ datetime: day.toISOString().slice(0, 10), close: String(close) });
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return bars;
}

function twelveResponse(symbol, values) {
  return Response.json({ meta: { symbol, exchange: 'NASDAQ', currency: 'USD' }, values, status: 'ok' });
}

test('finds the prior regular weekday in each market’s local time', () => {
  assert.deepEqual(sessionFor('US', new Date('2026-11-30T10:30:00Z')), { date: '2026-11-27', canSignal: true });
  assert.deepEqual(sessionFor('US', new Date('2026-11-30T23:00:00Z')), { date: '2026-11-27', canSignal: false });
  assert.deepEqual(sessionFor('IN', new Date('2026-12-01T02:30:00Z')), { date: '2026-11-30', canSignal: true });
  assert.deepEqual(sessionFor('IN', new Date('2026-11-29T02:30:00Z')), { date: '2026-11-27', canSignal: false });
  assert.equal(marketForCron('30 10 * * MON-FRI'), 'US');
  assert.equal(marketForCron('30 2 * * MON-FRI'), 'IN');
});

test('ignores future bars and blocks stale, incomplete, and unauthorized responses', async () => {
  const end = '2026-11-25';
  const values = candles(end);
  const load = (response, key = 'test-key') => loadCloses(us, end, key, async () => response);
  const fresh = await load(twelveResponse('AAPL', [{ datetime: '2026-11-26', close: '1000' }, ...values].reverse()));
  assert.equal(fresh.status, 'Ready');
  assert.equal(fresh.prices.length, 51);
  assert.deepEqual(fresh.close, { date: end, price: 10100 });
  assert.equal((await load(twelveResponse('AAPL', values.slice(1)))).status, 'No close for expected session');
  assert.equal((await load(twelveResponse('AAPL', values.slice(0, 50)))).status, 'Fewer than 51 daily closes');
  assert.equal((await load(twelveResponse('AAPL', [values[0], ...values]))).status, 'Invalid daily history');
  assert.equal((await load(twelveResponse('MSFT', values))).status, 'Unexpected provider response');
  assert.equal((await load(Response.json({ status: 'error', code: 429 }))).status, 'Provider limit reached');
  assert.equal((await load(Response.json({}, { status: 401 }))).status, 'Access denied');
  assert.equal((await load(null, '')).status, 'Credentials needed');
});

test('both feeds store closes and signals once without disturbing the sample workflow', async t => {
  const DB = openDatabase();
  t.after(() => DB.close());
  const env = { DB, TWELVE_DATA_API_KEY: 'test-us', UPSTOX_ANALYTICS_TOKEN: 'test-in' };
  let providerCalls = 0;
  let direction = 'up';
  const fetchData = async (url, { headers }) => {
    providerCalls++;
    if (url.hostname === 'api.twelvedata.com') {
      assert.equal(url.searchParams.get('apikey'), 'test-us');
      assert.equal(url.searchParams.get('interval'), '1day');
      assert.equal(url.searchParams.get('exchange'), 'NASDAQ');
      const cutoff = url.searchParams.get('end_date');
      assert.match(cutoff, /^\d{4}-\d{2}-\d{2}T23:59:59$/);
      return twelveResponse(url.searchParams.get('symbol'), candles(cutoff.slice(0, 10), direction));
    }
    assert.equal(url.hostname, 'api.upstox.com');
    assert.equal(headers.Authorization, 'Bearer test-in');
    assert.match(decodeURIComponent(url.pathname), /historical-candle\/NSE_EQ\|INE(?:090A01021|002A01018)\/days\/1\//);
    const date = url.pathname.split('/').at(-2);
    return Response.json({
      status: 'success',
      data: { candles: candles(date, direction).map(bar => [
        bar.datetime + 'T00:00:00+05:30', 100, 110, 90, Number(bar.close)
      ]) }
    });
  };
  const usTime = new Date('2026-11-25T10:30:00Z');
  const indiaTime = new Date('2026-11-25T02:30:00Z');
  const scan = options => runLiveScan(env, { fetchData, ...options });
  await Promise.all([
    scan({ market: 'US', now: usTime }), scan({ market: 'US', now: usTime }),
    scan({ market: 'IN', now: indiaTime }), scan({ market: 'IN', now: indiaTime })
  ]);
  assert.equal(providerCalls, 8);
  const observations = (await DB.prepare('SELECT * FROM market_observations').all()).results;
  assert.equal(observations.filter(stock => stock.status === 'Checked').length, 4);
  assert.ok(observations.every(stock => stock.close_price === 10100 && stock.checked_at ===
    (stock.market === 'US' ? usTime : indiaTime).toISOString()));
  const count = async table => (await DB.prepare('SELECT count(*) AS total FROM ' + table).first()).total;
  assert.equal(await count('alerts'), 4);
  assert.equal(await count('emails'), 4);
  assert.equal((await DB.prepare("SELECT exchange FROM alerts WHERE symbol='RELIANCE'").first()).exchange, 'NSE');

  await runDemo(env);
  await runDemo(env);
  assert.equal(await count('alerts'), 8);

  direction = 'down';
  await scan({ market: 'IN', now: new Date('2026-11-26T02:30:00Z') });
  await scan({ market: 'US', now: new Date('2026-11-26T10:30:00Z') });
  assert.equal(await count('alerts'), 12);
  assert.equal(await count('emails'), 12);

  await scan({ market: 'US', now: new Date('2026-11-27T10:30:00Z'), fetchData: async () => {
    return Response.json({ status: 'error', code: 429 });
  }});
  const saved = await DB.prepare("SELECT status, close_date FROM market_observations WHERE symbol = 'AAPL'").first();
  assert.equal(saved.status, 'Provider limit reached');
  assert.ok(saved.close_date);
  assert.equal(await count('alerts'), 12);
});
