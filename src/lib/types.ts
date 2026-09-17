export const DENOMS = [10, 20, 25, 50, 100] as const;
export type Denom = (typeof DENOMS)[number];

export const NETWORKS = ["usdt-bep20", "btc"] as const;
export type Network = (typeof NETWORKS)[number];

export type OrderStatus =
  | "awaiting"
  | "checking"
  | "paid"
  | "credited"
  | "delivered"
  | "cancelled"
  | "expired";

export type PinStatus = "stock" | "reserved" | "sold";

export type Pin = {
  id: string;
  denom: Denom;
  pin: string;
  serial: string;
  status: PinStatus;
  orderId?: string;
};

export type Order = {
  id: string;
  kind: "deposit" | "card";
  createdAt: number;
  expiresAt: number;
  denom?: Denom;
  network: Network;
  payAmount: string;
  payAsset: "USDT" | "BTC";
  address: string;
  status: OrderStatus;
  creditCents?: number;
  pinId?: string;
  pin?: string;
  serial?: string;
  deliveredAt?: number;
};

export type PriceRow = {
  denom: Denom;
  usdt: number;
};

export type Settings = {
  shopName: string;
  botName: string;
  markupNote: string;
  prices: PriceRow[];
  wallets: Record<Network, string>;
  autoConfirm: boolean;
  allowlistOn: boolean;
  allowlist: string[];
  btcUsd: number;
};

export type KeyStyle = "default" | "primary" | "ghost" | "danger";

export type KeyboardButton = {
  id: string;
  label: string;
  style?: KeyStyle;
  wide?: boolean;
};

export type ChatKind = "text" | "pay" | "pin" | "status";

export type ChatMessage = {
  id: string;
  from: "bot" | "user";
  at: number;
  kind: ChatKind;
  text?: string;
  keyboard?: KeyboardButton[][];
  orderId?: string;
};

export type BotScreen =
  | { name: "home" }
  | { name: "deposit" }
  | { name: "catalog" }
  | { name: "pay"; orderId: string }
  | { name: "done"; orderId: string }
  | { name: "orders" }
  | { name: "help" };
