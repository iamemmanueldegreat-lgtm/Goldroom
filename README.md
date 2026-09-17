# Goldroom

Private Razer Gold US desk. Buyers deposit USDT on BEP20. You fund FazerCards, credit their Goldroom balance, then they buy PINs from the Fazer API.

## Railway

Connect this repo as the service source. Leave **Root Directory** blank.

Variables (never commit these):

```
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_ID
WALLET_USDT_BEP20
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CARD_API_KEY
```

Optional: `FAZER_CATEGORY_ID`, `ALLOWLIST`, `WALLET_BTC`.

Start command: `node server.mjs`

## Supabase

Run `bot/schema.sql` then `bot/schema-v2.sql` in the SQL Editor.

## Flow

1. Buyer taps **Deposit** and sends the exact BEP20 amount.
2. You send that USDT to FazerCards.
3. You tap **Credit balance** on the admin message.
4. Buyer taps **Buy Razer Gold**. The PIN is pulled from Fazer.

Admin: `/balance` (shows Fazer wallet too), `/catalog` (Razer offers), `/credit 123456789 25`.
