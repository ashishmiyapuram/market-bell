export function evaluateCloses(closes) {
  if (closes.length < 51 || closes.some(price => !Number.isSafeInteger(price) || price <= 0)) {
    return null;
  }

  const previousWindow = closes.slice(-51, -1);
  const currentWindow = closes.slice(-50);
  const previousClose = previousWindow.at(-1);
  const close = currentWindow.at(-1);
  const previousTotal = previousWindow.reduce((sum, price) => sum + price, 0);
  const currentTotal = currentWindow.reduce((sum, price) => sum + price, 0);

  if (previousClose * 50 <= previousTotal && close * 50 > currentTotal) {
    return { action: 'BUY', close, limit: Math.floor(close * 101 / 100),
      reason: 'Closed above the 50-session moving average after being at or below it.' };
  }
  if (previousClose * 50 >= previousTotal && close * 50 < currentTotal) {
    return { action: 'SELL', close, limit: Math.ceil(close * 99 / 100),
      reason: 'Closed below the 50-session moving average after being at or above it.' };
  }
  return null;
}
