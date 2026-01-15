# OKX × Gate.io Earn Arbitrage (Serverless)

Show Top 20 opportunities where **Gate Earn APR** is higher than **OKX Borrow APR**.

- Deploy to **Netlify** (no VPS)
- Optional: **Telegram alerts**
- Optional: OKX private endpoint for **max loan / remaining quota**

## Endpoints
- UI: `/`
- JSON: `/.netlify/functions/api`
- Poll + Telegram: `/.netlify/functions/poll`

## Environment Variables (Netlify)
Required for Telegram alerts:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional for OKX max-loan:
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`

Optional for caching / anti-spam:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Notes
Gate earn endpoint used:
- `GET https://api.gateio.ws/api/v4/earn/uni/currencies`

Gate returns **daily rate** in `max_rate` / `min_rate`.
We convert to APR%: `APR = daily_rate * 365 * 100`.
