# Goldroom

Private Razer Gold US desk. Buyers pay USDT on BEP20. PINs arrive in Telegram.

## Railway

Connect this repo as the service source. Leave **Root Directory** blank.

Variables (never commit these):

```
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_ID
WALLET_USDT_BEP20
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional: `CARD_API_KEY`, `ALLOWLIST`, `WALLET_BTC`.

Start command: `node server.mjs`

## Supabase

Once, in the Supabase SQL Editor, run `bot/schema.sql`. Then redeploy.

After a green deploy, send `/start` to the bot, then load stock (admin only):

`/stock 25 PIN SERIAL`

`ADMIN_TELEGRAM_ID` is your numeric id from [@userinfobot](https://t.me/userinfobot).
