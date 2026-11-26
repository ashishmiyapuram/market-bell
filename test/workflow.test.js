import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { openDatabase } from '../src/local-db.js';
import { evaluateCloses } from '../src/strategy.js';

test('the closing-price rule requires a crossover and rounds limits conservatively', () => {
  assert.equal(evaluateCloses(Array(51).fill(10000)), null);
  assert.equal(evaluateCloses(Array(50).fill(10000)), null);
  const buy = evaluateCloses([...Array(50).fill(10000), 10100]);
  assert.equal(buy.action, 'BUY');
  assert.equal(buy.limit, 10201);
  const sell = evaluateCloses([...Array(49).fill(10000), 10100, 9801]);
  assert.equal(sell.action, 'SELL');
  assert.equal(sell.limit, 9703);
});

test('sign in, scan both markets twice, export records, and sign out', async t => {
  const DB = openDatabase();
  t.after(() => DB.close());
  const env = { DB, APP_USERNAME: 'demo', APP_PASSWORD: 'test-password', SESSION_SECRET: 'a'.repeat(64) };
  const origin = 'https://stocks.example';
  const request = (path, options) => worker.fetch(new Request(origin + path, options), env);
  const loginPage = await request('/login');
  assert.equal(loginPage.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal((await request('/login', { method: 'POST', headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await request('/emails.csv')).headers.get('Location'), '/login');
  const credentials = password => ({ method: 'POST', headers: { Origin: origin },
    body: new URLSearchParams({ username: 'demo', password }) });
  assert.equal((await request('/login', credentials('wrong'))).status, 401);
  const login = await request('/login', credentials('test-password'));
  assert.equal(login.status, 303);
  const setCookie = login.headers.get('Set-Cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  const Cookie = setCookie.split(';')[0];
  const post = { method: 'POST', headers: { Cookie, Origin: origin } };
  assert.equal((await request('/scan', { method: 'POST', headers: { Cookie } })).status, 403);
  for (let scan = 0; scan < 3; scan++) assert.equal((await request('/scan', post)).status, 303);
  const home = await request('/', { headers: { Cookie } });
  assert.match(await home.text(), /Sample complete/);
  const results = await (await request('/recommendations.csv', { headers: { Cookie } })).text();
  assert.equal(results.trim().split('\r\n').length, 5);
  assert.match(results, /"USD","101.00","102.01"/);
  assert.match(results, /"INR","1960.00","1940.40"/);
  const emails = await (await request('/emails.csv', { headers: { Cookie } })).text();
  assert.equal(emails.match(/"Preview"/g).length, 4);
  const logout = await request('/logout', post);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('a failed email can be retried without adding another recommendation', async t => {
  const DB = openDatabase();
  t.after(() => DB.close());
  const env = {
    DB, APP_USERNAME: 'demo', APP_PASSWORD: 'test-password', SESSION_SECRET: 'a'.repeat(64),
    RESEND_API_KEY: 'fake', ALERT_TO: 'owner@example.com', ALERT_FROM: 'sender@example.com'
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    requests.push(options.headers['Idempotency-Key']);
    return requests.length === 1
      ? new Response(null, { status: 500 })
      : Response.json({ id: 'receipt-' + requests.length });
  });

  const origin = 'https://stocks.example';
  const login = await worker.fetch(new Request(origin + '/login', {
    method: 'POST', headers: { Origin: origin },
    body: new URLSearchParams({ username: 'demo', password: 'test-password' })
  }), env);
  const Cookie = login.headers.get('Set-Cookie').split(';')[0];
  const scan = () => worker.fetch(new Request(origin + '/scan', {
    method: 'POST', headers: { Cookie, Origin: origin }
  }), env);

  assert.equal((await scan()).status, 303);
  const failed = await DB.prepare("SELECT * FROM emails WHERE status = 'Failed'").first();
  assert.ok(failed);
  assert.equal((await scan()).status, 303);
  const retried = await DB.prepare('SELECT * FROM emails WHERE alert_id = ?').bind(failed.alert_id).first();
  assert.equal(retried.status, 'Accepted');
  assert.ok(retried.accepted_at);
  assert.equal(requests[0], requests[2]);
  assert.equal((await DB.prepare('SELECT count(*) AS total FROM alerts').first()).total, 4);
});
