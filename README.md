# Market Bell

A private prototype for testing a stock-alert workflow across US and Indian markets. Version one uses fictional daily closes. It calculates a 50-session moving-average crossover, suggests a 1% price buffer, and stores a recommendation with a matching email record.

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

## Scope of this prototype

The editable live watchlist, provider integrations, unattended five-minute and daily scans, simulated fills, fundamentals, and news are later milestones. The second sample scan demonstrates a sell after a buy signal. It uses a scripted scenario without trade-fill modeling. There is no broker execution.
