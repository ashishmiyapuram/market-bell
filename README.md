# Market Bell

A private prototype for testing a stock-alert workflow across US and Indian markets. The sample workflow uses fictional daily closes. The market watchlist can also read real daily closes from Twelve Data and Upstox. It calculates a 50-session moving-average crossover, suggests a 1% price buffer, and stores a recommendation with a matching email record.

## Try it locally

Requires Node.js 24 or later. There are no application dependencies to install.

```sh
node src/local.js
```

Open http://127.0.0.1:8080 and sign in with username `demo` and password `stock-demo`. Select **Run sample scan** twice. The first scan generates buy signals and the second generates sell signals. Expand each email subject to read its body, and download either CSV from the dashboard.

The local server listens on your computer only. It stores records in `tradingapp.sqlite` and previews emails. To try a fresh sample without deleting existing records, start the server with a different database path:

```sh
LOCAL_DB=tradingapp-second.sqlite node src/local.js
```

Run the tests with `node --test`. They use an in-memory SQLite database.

## Cloudflare setup

The Worker uses D1 for storage, Worker secrets for the single account, and the free `workers.dev` address. Provisioning requires access to your Cloudflare and GitHub accounts.

1. Install or run Wrangler from a Node.js installation with npm. Sign in with `npx wrangler login`.
2. Run `npx wrangler d1 create stock-alerts`. Copy the database ID into `wrangler.jsonc`, then apply the schema with `npx wrangler d1 migrations apply stock-alerts --remote`.
3. Set `APP_USERNAME`, `APP_PASSWORD`, and `SESSION_SECRET` using `npx wrangler secret put NAME` for each. Use a unique password and a random session secret of at least 32 characters. `openssl rand -hex 32` can generate the session secret. The local demo credentials are only for loopback use.
4. For optional real sample emails, set `RESEND_API_KEY`, `ALERT_FROM`, and `ALERT_TO` the same way. Resend's test sender is limited to the account owner's email. New scans with all three secrets create queued email records. The dashboard shows when Resend accepts a message. Inbox delivery confirmation requires a separate webhook.
5. Run `npx wrangler deploy` for the first deployment. Verify sign-in, a sample scan, and CSV download at the URL Wrangler returns.

## Continuous deployment

GitHub Actions runs tests on pull requests and pushes to `main`. In the Cloudflare dashboard, connect the Worker to the selected GitHub repository using Workers Builds, choose the production branch, set the build command to `node --test`, and use `npx wrangler deploy` as the deploy command. Set the Workers Builds runtime to Node.js 24 or later. Leave preview builds disabled until a separate demo D1 database and preview credentials are provisioned. Keep Worker secrets out of Git. Apply future D1 migrations separately before deploying code that depends on them.

See [Cloudflare production branch setup](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) and [Resend sender restrictions](https://resend.com/docs/api-reference/errors).

## Connect market data

The Market watchlist starts with Apple and Microsoft on Nasdaq, and Reliance Industries and ICICI Bank on NSE. Either provider can be enabled independently.

1. Apply the market-data migration to the existing D1 database before deploying the updated Worker. `npx wrangler d1 migrations apply stock-alerts --remote` applies any outstanding files.
2. Get a [Twelve Data Basic key](https://twelvedata.com/pricing) and an [Upstox Analytics Token](https://upstox.com/developer/api-documentation/announcements/analytics-token/). The Upstox token is read-only.
3. Under the Worker’s **Settings → Runtime variables and secrets**, add `TWELVE_DATA_API_KEY` and `UPSTOX_ANALYTICS_TOKEN` as Production secrets. Dashboard variables are retained by future Wrangler deploys. Keep API credentials out of Git.
4. Sign in and use **Check market data**. Check that the table shows the provider, completed session date, and close. A holiday, late daily bar, or provider failure leaves the last stored close visible and suppresses signals for that check.
5. After checking both feeds, add the Production runtime variable `LIVE_SCHEDULE_ENABLED` with value `1`. Weekday scans run at 8:00 a.m. India time and 5:30 a.m. Eastern Standard Time or 6:30 a.m. Eastern Daylight Time. Each scan requests the previous weekday's completed prices. Weekend and missing-session bars never produce a catch-up alert.

The app evaluates the 50-session crossover from 51 reported closes and sends only before the next regular opening window. A sell signal follows an earlier recorded buy signal for that symbol. It expresses a change in the strategy and does not represent a tracked holding or fill. The app can show prices on a manual scan outside the alert window. Resend delivery uses the existing `RESEND_API_KEY`, `ALERT_FROM`, and `ALERT_TO` secrets when present. Otherwise alerts are saved as email previews.

The dashboard and CSVs label records by source. Intraday polling, an editable watchlist, simulated fills, corporate-action validation across providers, fundamentals, and news are outside this daily-price release. The second sample scan demonstrates a sell after a buy signal. It uses a scripted scenario without trade-fill modeling. There is no broker execution.
