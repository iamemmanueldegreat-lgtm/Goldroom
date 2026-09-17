# Goldroom

Private Razer Gold US desk. Buyers pay USDT on BEP20. PINs arrive in Telegram.

## Railway

1. New service → connect this repo.
2. Variables (never commit these):

```
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_ID
WALLET_USDT_BEP20
```

Optional: `CARD_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWLIST`, `WALLET_BTC`.

3. Start command: `node bot/server.mjs`
4. Deploy, then in Telegram send `/start` to the bot.
5. Load stock (admin only): `/stock 25 PIN SERIAL`

`ADMIN_TELEGRAM_ID` is your numeric id from [@userinfobot](https://t.me/userinfobot). Only that account can confirm payments and add PINs.
