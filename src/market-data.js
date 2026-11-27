const markets = {
  US: { source: 'Twelve Data', currency: 'USD', timeZone: 'America/New_York', openHour: 9,
    openMinute: 30, secret: 'TWELVE_DATA_API_KEY', cron: '30 10 * * MON-FRI', code: 1 },
  IN: { source: 'Upstox', currency: 'INR', timeZone: 'Asia/Kolkata', openHour: 9,
    openMinute: 15, secret: 'UPSTOX_ANALYTICS_TOKEN', cron: '30 2 * * MON-FRI', code: 2 }
};

export const marketProfiles = Object.fromEntries(Object.entries(markets).map(([market, config]) => [
  market, { ...config, clock: new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }) }
]));

export function sessionFor(market, now) {
  const config = marketProfiles[market];
  const parts = Object.fromEntries(config.clock.formatToParts(now).map(part => [part.type, part.value]));
  const today = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const expected = new Date(today);
  do {
    expected.setUTCDate(expected.getUTCDate() - 1);
  } while (expected.getUTCDay() === 0 || expected.getUTCDay() === 6);

  return {
    date: expected.toISOString().slice(0, 10),
    canSignal: today.getUTCDay() >= 1 && today.getUTCDay() <= 5 &&
      Number(parts.hour) * 60 + Number(parts.minute) < config.openHour * 60 + config.openMinute
  };
}

function requestFor(stock, date, key) {
  if (stock.market === 'US') {
    const url = new URL('https://api.twelvedata.com/time_series');
    url.search = new URLSearchParams({
      apikey: key, symbol: stock.provider_key, exchange: stock.exchange, interval: '1day',
      end_date: date + 'T23:59:59', outputsize: '60', order: 'desc', adjust: 'splits'
    }).toString();
    return [url, { Accept: 'application/json' }];
  }
  const start = new Date(date + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 110);
  const path = [encodeURIComponent(stock.provider_key), 'days', '1', date, start.toISOString().slice(0, 10)];
  return [new URL('https://api.upstox.com/v3/historical-candle/' + path.join('/')),
    { Accept: 'application/json', Authorization: 'Bearer ' + key }];
}

function canonicalBar(date, raw) {
  if (typeof date !== 'string' || !['string', 'number'].includes(typeof raw)) return null;
  const price = Math.round(Number(raw) * 100);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isSafeInteger(price) && price > 0
    ? { date, price } : null;
}

export async function loadCloses(stock, date, key, fetchData = fetch) {
  if (!key) return { status: 'Credentials needed' };

  const [url, headers] = requestFor(stock, date, key);
  let response;
  let data;
  try {
    response = await fetchData(url, { headers, signal: AbortSignal.timeout(8000), redirect: 'error' });
    data = await response.json();
  } catch {
    return { status: 'Provider unavailable' };
  }

  const code = Number(data?.code ?? response.status);
  if ([401, 403].includes(code) || [401, 403].includes(response.status)) return { status: 'Access denied' };
  if (code === 429 || response.status === 429) return { status: 'Provider limit reached' };
  if (!response.ok || data?.status === 'error') return { status: 'Provider unavailable' };

  let bars;
  if (stock.market === 'US') {
    if (data?.meta?.symbol !== stock.provider_key || data?.meta?.currency !== 'USD' ||
        String(data?.meta?.exchange).toUpperCase() !== stock.exchange || !Array.isArray(data.values)) {
      return { status: 'Unexpected provider response' };
    }
    bars = data.values.map(bar => canonicalBar(bar?.datetime, bar?.close));
  } else {
    if (data?.status !== 'success' || !Array.isArray(data?.data?.candles)) {
      return { status: 'Unexpected provider response' };
    }
    bars = data.data.candles.map(bar => canonicalBar(
      typeof bar?.[0] === 'string' ? bar[0].slice(0, 10) : null, bar?.[4]
    ));
  }

  if (bars.includes(null) || new Set(bars.map(bar => bar.date)).size !== bars.length) {
    return { status: 'Invalid daily history' };
  }
  const completed = bars.filter(bar => bar.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const close = completed.at(-1);
  if (close?.date !== date) return { status: 'No close for expected session', close };
  if (completed.length < 51) return { status: 'Fewer than 51 daily closes', close };
  return { status: 'Ready', close, prices: completed.slice(-51).map(bar => bar.price) };
}
