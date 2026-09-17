import type { Denom, Network, PriceRow, Settings } from "./types";
import { DENOMS } from "./types";

export const NETWORK_META: Record<
  Network,
  { label: string; asset: "USDT" | "BTC"; chain: string; hint: string }
> = {
  "usdt-bep20": {
    label: "USDT",
    asset: "USDT",
    chain: "BEP20",
    hint: "BNB Smart Chain · USDT only on this chain",
  },
  btc: {
    label: "Bitcoin",
    asset: "BTC",
    chain: "BTC",
    hint: "On-chain · slower confirm",
  },
};

export const DEFAULT_PRICES: PriceRow[] = [
  { denom: 10, usdt: 11.5 },
  { denom: 20, usdt: 22.8 },
  { denom: 25, usdt: 28.2 },
  { denom: 50, usdt: 55.5 },
  { denom: 100, usdt: 109 },
];

export const DEFAULT_SETTINGS: Settings = {
  shopName: "Goldroom",
  botName: "Goldroom",
  markupNote: "Price includes the desk fee. Nothing extra at payment.",
  prices: DEFAULT_PRICES,
  wallets: {
    "usdt-bep20": "0x00000000000000000000000000000000d0000001",
    btc: "bc1qdemogoldroomvault000000000000",
  },
  autoConfirm: true,
  allowlistOn: false,
  allowlist: [],
  btcUsd: 64_000,
};

export function priceFor(prices: PriceRow[], denom: Denom): number {
  return prices.find((p) => p.denom === denom)?.usdt ?? denom * 1.12;
}

export function uniquePayAmount(
  baseUsdt: number,
  seq: number,
  network: Network,
  btcUsd: number,
): { amount: string; asset: "USDT" | "BTC" } {
  const bump = 10 + (seq % 87);
  if (network === "btc") {
    const btc = (baseUsdt + bump / 100) / btcUsd;
    return { amount: btc.toFixed(6), asset: "BTC" };
  }
  const cents = Math.round(baseUsdt * 100) + bump;
  return { amount: (cents / 100).toFixed(2), asset: "USDT" };
}

export function seedPins(): import("./types").Pin[] {
  const pins: import("./types").Pin[] = [];
  let n = 1;
  for (const denom of DENOMS) {
    for (let i = 0; i < 3; i += 1) {
      const serial = `DEMO-${denom}-${String(n).padStart(4, "0")}`;
      pins.push({
        id: `pin-${n}`,
        denom,
        pin: `0000${String(denom).padStart(2, "0")}${String(n).padStart(8, "0")}`,
        serial,
        status: "stock",
      });
      n += 1;
    }
  }
  return pins;
}

export function maskPin(pin: string): string {
  if (pin.length < 6) return "••••";
  return `${pin.slice(0, 4)} •••• ${pin.slice(-4)}`;
}

export function prettyPin(pin: string): string {
  return pin.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}
