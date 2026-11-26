import { evaluateCloses } from './strategy.js';
import { dashboard, login, csv } from './views.js';

const cookieName = 'stock_alert_session';
const sessionLifetime = 8 * 60 * 60;
const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function safeEqual(left, right) {
  const hash = value => crypto.subtle.digest('SHA-256', encoder.encode(value));
  const [a, b] = (await Promise.all([hash(left), hash(right)])).map(value => new Uint8Array(value));
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function signature(value, env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function authorized(request, env) {
  const cookie = (request.headers.get('Cookie') ?? '').split(';')
    .map(part => part.trim()).find(part => part.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1) ?? '';
  if (!/^\d{10}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, signed] = token.split('.');
  if (Number(expires) <= Date.now() / 1000) return false;
  return safeEqual(signed, await signature(expires, env));
}

function sessionCookie(request, token, age) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + secure;
}

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};

function html(body, status = 200) {
  return new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

function redirect(location, cookie) {
  const response = new Response(null, { status: 303, headers: { ...headers, Location: location } });
  if (cookie) response.headers.set('Set-Cookie', cookie);
  return response;
}

async function rows(db, sql, ...params) {
  return (await db.prepare(sql).bind(...params).all()).results;
}

function prices(run, market) {
  const center = market === 'US' ? 10000 : 200000;
  const closes = Array(50).fill(center);
  if (run === 2) closes[49] = Math.round(center * 1.01);
  closes.push(Math.round(center * (run === 1 ? 1.01 : 0.98)));
  return closes;
}

export async function runDemo(env) {
  const db = env.DB;
  const last = await db.prepare('SELECT MAX(id) AS id FROM runs').first();
  const run = (last.id ?? 0) + 1;
  if (run > 2) return;
  const now = new Date().toISOString();
  const marketDate = run === 1 ? '2025-01-06' : '2025-01-07';
  const symbols = await rows(db, 'SELECT * FROM watchlist ORDER BY market, symbol');
  const statements = [db.prepare('INSERT INTO runs VALUES (?, ?)').bind(run, now)];

  for (const stock of symbols) {
    const signal = evaluateCloses(prices(run, stock.market));
    if (!signal) continue;
    if (signal.action === 'SELL') {
      const previous = await db.prepare(
        'SELECT action FROM alerts WHERE market = ? AND symbol = ? ORDER BY id DESC LIMIT 1'
      ).bind(stock.market, stock.symbol).first();
      if (previous?.action !== 'BUY') continue;
    }
    const currency = stock.market === 'US' ? 'USD' : 'INR';
    const subject = '[Sample] ' + signal.action + ' ' + stock.symbol + ' · ' + stock.company;
    const body = [
      stock.company + ' (' + stock.symbol + ', ' + stock.market + ')',
      signal.action + ' signal for ' + marketDate,
      'Trigger close: ' + currency + ' ' + (signal.close / 100).toFixed(2),
      (signal.action === 'BUY' ? 'Maximum buy price: ' : 'Minimum sell price: ') +
        currency + ' ' + (signal.limit / 100).toFixed(2),
      'Valid during the next sample session.',
      signal.reason,
      'Source: fictional sample data.'
    ].join('\n');
    statements.push(db.prepare(`
      INSERT INTO alerts (run_id, market, symbol, company, currency, action, market_date,
        trigger_price, limit_price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(run, stock.market, stock.symbol, stock.company, currency, signal.action, marketDate,
      signal.close, signal.limit, signal.reason));
    statements.push(db.prepare(`
      INSERT INTO emails (alert_id, subject, body, recipient, created_at, status, send_key)
      SELECT id, ?, ?, ?, ?, ?, ? FROM alerts
      WHERE market = ? AND symbol = ? AND market_date = ?
    `).bind(subject, body, env.ALERT_TO ?? '', now,
      env.RESEND_API_KEY && env.ALERT_TO && env.ALERT_FROM ? 'Pending' : 'Preview',
      crypto.randomUUID(), stock.market, stock.symbol, marketDate));
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed: runs.id/.test(String(error))) return;
    throw error;
  }
}

async function sendPending(env) {
  if (!env.RESEND_API_KEY || !env.ALERT_FROM || !env.ALERT_TO) return;
  const queued = await rows(env.DB, "SELECT * FROM emails WHERE status IN ('Pending', 'Failed') ORDER BY alert_id");
  for (const email of queued) {
    // Resend's idempotency keys expire after 24 hours. Preserve the record for manual review.
    if (Date.now() - Date.parse(email.created_at) >= 23 * 60 * 60 * 1000) continue;
    let response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json',
          'Idempotency-Key': 'stock-alert-sample-' + email.send_key },
        body: JSON.stringify({ from: env.ALERT_FROM, to: [email.recipient], subject: email.subject, text: email.body }),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      response = null;
    }
    const receipt = response?.ok ? await response.json().catch(() => null) : null;
    await env.DB.prepare(`
      UPDATE emails SET status = ?, provider_id = ?, accepted_at = ?
      WHERE alert_id = ? AND status != 'Accepted'
    `).bind(receipt?.id ? 'Accepted' : 'Failed', receipt?.id ?? null,
      receipt?.id ? new Date().toISOString() : null, email.alert_id).run();
  }
}

const selectSignals = 'SELECT * FROM alerts ORDER BY id DESC';
const selectEmails = `SELECT emails.*, alerts.market, alerts.symbol FROM emails
  JOIN alerts ON alerts.id = emails.alert_id ORDER BY alert_id DESC`;

async function handle(request, env) {
  const url = new URL(request.url);
  if (!env.APP_USERNAME || !env.APP_PASSWORD || (env.SESSION_SECRET?.length ?? 0) < 32) {
    return new Response('Configure APP_USERNAME, APP_PASSWORD and SESSION_SECRET first.', { status: 503, headers });
  }
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) {
    return new Response('Invalid request origin.', { status: 403, headers });
  }
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    return new Response('Method not allowed.', { status: 405, headers });
  }
  if (url.pathname === '/login') {
    if (request.method !== 'POST') return html(login());
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      return new Response('Invalid form.', { status: 400, headers });
    }
    if (env.LOGIN_LIMITER) {
      const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.LOGIN_LIMITER.limit({ key });
      if (!success) return html(login('Too many attempts. Try again in a minute.'), 429);
    }
    const form = await request.formData();
    const [user, password] = await Promise.all([
      safeEqual(String(form.get('username') ?? ''), env.APP_USERNAME),
      safeEqual(String(form.get('password') ?? ''), env.APP_PASSWORD)
    ]);
    if (!user || !password) return html(login('Check your username and password.'), 401);
    const expires = String(Math.floor(Date.now() / 1000) + sessionLifetime);
    return redirect('/', sessionCookie(request, expires + '.' + await signature(expires, env), sessionLifetime));
  }
  if (!await authorized(request, env)) return redirect('/login');
  const db = env.DB;
  if (request.method === 'POST') {
    if (url.pathname === '/logout') return redirect('/login', sessionCookie(request, '', 0));
    if (url.pathname === '/scan') {
      await runDemo(env);
      await sendPending(env);
      return redirect('/');
    }
  } else if (url.pathname === '/') {
    const [watchlist, runs, signals, emails] = await Promise.all([
      rows(db, 'SELECT * FROM watchlist ORDER BY market DESC, symbol'),
      rows(db, 'SELECT * FROM runs ORDER BY id DESC'),
      rows(db, selectSignals), rows(db, selectEmails)
    ]);
    return html(dashboard({ watchlist, runs, signals, emails }));
  } else if (['/recommendations.csv', '/emails.csv'].includes(url.pathname)) {
    const signals = url.pathname === '/recommendations.csv';
    const data = await rows(db, signals ? selectSignals : selectEmails);
    return new Response(csv(data, signals), { headers: {
      ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + url.pathname.slice(1) + '"'
    } });
  }
  return new Response('Page not found.', { status: 404, headers });
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(error);
      return new Response('The dashboard could not complete this request.', { status: 500, headers });
    }
  }
};
