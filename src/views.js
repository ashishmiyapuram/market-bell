const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const styles = `
  :root { color-scheme: light; font-family: system-ui, sans-serif; color: #142940; background: #f4f7fa; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  header { background: #142940; color: white; }
  header > div, main { max-width: 1100px; margin: auto; padding: 20px 24px; }
  header > div, .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
  header strong { font-size: 1.15rem; }
  main { padding-top: 34px; padding-bottom: 40px; }
  h1 { margin: 0; font-size: clamp(1.85rem, 5vw, 2.7rem); letter-spacing: -.04em; }
  h2 { font-size: 1.2rem; margin: 0; }
  p { line-height: 1.5; }
  .muted { color: #465d73; }
  .hero { margin-bottom: 24px; }
  .hero p { margin-bottom: 0; }
  section { background: white; border: 1px solid #dae3ec; border-radius: 14px; margin: 18px 0; padding: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 16px; }
  .stock { border: 1px solid #dae3ec; border-radius: 10px; padding: 14px; }
  .stock p { margin: 4px 0 0; }
  .scroller { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: .9rem; }
  th, td { text-align: left; padding: 13px 10px; border-bottom: 1px solid #e5ebf1; }
  th { color: #465d73; font-weight: 600; white-space: nowrap; }
  td { min-width: 80px; }
  .money { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .buy { color: #075b42; font-weight: 750; }
  .sell { color: #9b3b23; font-weight: 750; }
  button, .button { font: inherit; font-size: .9rem; font-weight: 650; min-height: 42px; padding: 9px 14px;
    border: 1px solid #c9d6e2; border-radius: 8px; color: #142940; background: white; cursor: pointer;
    text-decoration: none; display: inline-flex; align-items: center; }
  button.primary { background: #176353; color: white; border-color: #176353; }
  button:disabled { opacity: .6; cursor: default; }
  a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #397fc4; outline-offset: 2px; }
  .login { max-width: 452px; margin: 40px auto; }
  label { display: block; margin: 12px 0; font-weight: 600; }
  input { display: block; width: 100%; margin-top: 6px; border: 1px solid #a9bdcd; border-radius: 8px; padding: 10px; font: inherit; }
  .notice { border-left: 4px solid #176353; padding: 8px 12px; background: #e9f4f0; }
  .error { color: #9b3b23; }
  details p { white-space: pre-wrap; margin-bottom: 0; }
  summary { cursor: pointer; }
`;

function page(title, contents, signedIn) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · Market Bell</title><style>${styles}</style></head><body>
    <header><div><strong>Market Bell</strong>
    ${signedIn ? '<form method="post" action="/logout"><button>Sign out</button></form>' : ''}
    </div></header><main>${contents}</main></body></html>`;
}

export function login(error) {
  return page('Sign in', `<section class="login"><h1>Sign in</h1>
    <p class="muted">Access your private stock alert dashboard.</p>
    ${error ? '<p class="error" role="alert">' + escape(error) + '</p>' : ''}
    <form method="post" action="/login">
      <label>Username<input name="username" autocomplete="username" maxlength="128" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
      <button class="primary">Sign in</button>
    </form></section>`);
}

const money = (value, currency) => currency + ' ' + (value / 100).toFixed(2);

export function dashboard({ watchlist, runs, signals, emails }) {
  const stockCards = watchlist.map(stock => `<div class="stock"><strong>${escape(stock.company)}</strong>
    <p class="muted">${escape(stock.symbol)} · ${stock.market === 'US' ? 'United States' : 'India'}</p></div>`).join('');
  const signalRows = signals.map(signal => `<tr><td>${escape(signal.market_date)}</td>
    <td><strong>${escape(signal.symbol)}</strong><br>${escape(signal.company)}</td>
    <td class="${signal.action.toLowerCase()}">${signal.action}</td>
    <td class="money">${money(signal.trigger_price, signal.currency)}</td>
    <td class="money">${money(signal.limit_price, signal.currency)}</td>
    <td>${escape(signal.reason)}</td></tr>`).join('');
  const emailRows = emails.map(email => `<tr><td><details><summary>${escape(email.subject)}</summary>
    <p>${escape(email.body)}</p></details></td><td>${escape(email.recipient || 'Local preview')}</td>
    <td>${escape(email.status)}</td><td>${escape(email.created_at)}</td>
    <td>${escape(email.accepted_at ?? '—')}</td></tr>`).join('');
  const last = runs[0];
  const hasRetry = emails.some(email => ['Pending', 'Failed'].includes(email.status) &&
    Date.now() - Date.parse(email.created_at) < 23 * 60 * 60 * 1000);

  return page('Dashboard', `<div class="row hero">
    <div><h1>Watchlist dashboard</h1><p class="muted">Review US and India stock signals and their email history.</p></div>
    <form method="post" action="/scan"><button class="primary"${runs.length >= 2 && !hasRetry ? ' disabled' : ''}>
    ${runs.length >= 2 ? hasRetry ? 'Retry queued emails' : 'Sample complete' : 'Run sample scan'}</button></form>
    </div>
    <p class="notice">Sample mode uses fictional stocks and prices. Run two scans to see a buy signal followed by a sell signal for each market.</p>
    <section><div class="row"><h2>Watchlist</h2><p class="muted">Last scan ${last ? escape(last.scanned_at) : 'pending'}</p></div>
    <div class="grid">${stockCards}</div></section>
    <section><div class="row"><h2>Recommendations</h2><a class="button" href="/recommendations.csv">Download CSV</a></div>
    ${signals.length ? `<div class="scroller"><table aria-label="Recommendations"><thead><tr>
    <th>Market date</th><th>Company</th><th>Signal</th><th>Trigger close</th><th>Suggested limit</th><th>Reason</th>
    </tr></thead><tbody>${signalRows}</tbody></table></div>` : '<p class="muted">A sample scan will add the first recommendations.</p>'}
    </section>
    <section><div class="row"><h2>Email history</h2><a class="button" href="/emails.csv">Download CSV</a></div>
    ${emails.length ? `<div class="scroller"><table aria-label="Email history"><thead><tr>
    <th>Subject</th><th>Recipient</th><th>Status</th><th>Created (UTC)</th><th>Accepted (UTC)</th>
    </tr></thead><tbody>${emailRows}</tbody></table></div>` : '<p class="muted">Email previews appear here when a signal is generated.</p>'}
    </section>`, true);
}

function csvCell(value) {
  const string = String(value ?? '');
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(string) ? "'" + string : string;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csv(data, signals) {
  const headings = signals
    ? ['id', 'market_date', 'market', 'symbol', 'company', 'action', 'currency', 'trigger_price', 'limit_price', 'reason']
    : ['alert_id', 'market', 'symbol', 'recipient', 'subject', 'body', 'created_at', 'status', 'accepted_at', 'provider_id'];
  const records = data.map(row => headings.map(key => {
    const value = signals && ['trigger_price', 'limit_price'].includes(key) ? (row[key] / 100).toFixed(2) : row[key];
    return csvCell(value);
  }).join(','));
  return '\uFEFF' + [headings.join(','), ...records].join('\r\n') + '\r\n';
}
