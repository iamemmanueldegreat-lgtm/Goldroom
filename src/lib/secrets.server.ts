import { env } from "./env.server";
import type { Network } from "./types";

export type SecretGroup = "telegram" | "cards" | "data" | "wallets";

export type SecretDef = {
  key: string;
  label: string;
  group: SecretGroup;
  required: boolean;
  public?: boolean;
};

export const SECRET_DEFS: SecretDef[] = [
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram bot token",
    group: "telegram",
    required: true,
  },
  {
    key: "ADMIN_TELEGRAM_ID",
    label: "Your Telegram user id",
    group: "telegram",
    required: true,
  },
  {
    key: "CARD_API_KEY",
    label: "Card API key",
    group: "cards",
    required: true,
  },
  {
    key: "CARD_API_SECRET",
    label: "Card API secret",
    group: "cards",
    required: false,
  },
  {
    key: "SUPABASE_URL",
    label: "Supabase URL",
    group: "data",
    required: true,
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    label: "Supabase service role key",
    group: "data",
    required: true,
  },
  {
    key: "WALLET_USDT_BEP20",
    label: "USDT BEP20 address",
    group: "wallets",
    required: true,
    public: true,
  },
  {
    key: "WALLET_BTC",
    label: "Bitcoin address",
    group: "wallets",
    required: false,
    public: true,
  },
];

export type SecretRow = {
  key: string;
  label: string;
  group: SecretGroup;
  required: boolean;
  set: boolean;
};

export function secretStatus(): SecretRow[] {
  return SECRET_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    group: d.group,
    required: d.required,
    set: Boolean(env(d.key)),
  }));
}

export function liveWallets(): Partial<Record<Network, string>> {
  const bep20 = env("WALLET_USDT_BEP20");
  const btc = env("WALLET_BTC");
  const out: Partial<Record<Network, string>> = {};
  if (bep20) out["usdt-bep20"] = bep20;
  if (btc) out.btc = btc;
  return out;
}

export function requireSecret(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`${key} is not set`);
  return v;
}
