import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, priceFor, seedPins, uniquePayAmount } from "./catalog";
import type {
  BotScreen,
  ChatMessage,
  Denom,
  Network,
  Order,
  Pin,
  Settings,
} from "./types";
import { nid } from "./utils";
import { getLiveWallets } from "./secrets";

const ORDER_TTL_MS = 30 * 60 * 1000;
const DEPOSITS = [10, 25, 50, 100, 200];

type ShopState = {
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  settings: Settings;
  pins: Pin[];
  orders: Order[];
  seq: number;
  balanceCents: number;
  messages: ChatMessage[];
  screen: BotScreen;
  typing: boolean;
  patchSettings: (partial: Partial<Settings>) => void;
  setPrice: (denom: Denom, usdt: number) => void;
  addPins: (raw: string) => { added: number; errors: string[] };
  resetDemo: () => void;
  stockCount: (denom?: Denom) => number;
  expireStale: () => void;
  startChat: () => void;
  sendText: (text: string) => void;
  tap: (action: string) => void;
  confirmPayment: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;
};

function nextOrderId(seq: number): string {
  return `GR-${String(1000 + seq)}`;
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function botMsg(partial: Omit<ChatMessage, "id" | "from" | "at">): ChatMessage {
  return {
    id: nid("m"),
    from: "bot",
    at: Date.now(),
    ...partial,
  };
}

function userMsg(text: string): ChatMessage {
  return {
    id: nid("m"),
    from: "user",
    at: Date.now(),
    kind: "text",
    text,
  };
}

function homeKeyboard() {
  return [
    [
      { id: "deposit", label: "Deposit", style: "primary" as const },
      { id: "buy", label: "Buy Razer Gold", style: "primary" as const },
    ],
    [
      { id: "balance", label: "Balance" },
      { id: "orders", label: "Orders" },
    ],
    [{ id: "help", label: "Help", style: "ghost" as const }],
  ];
}

function depositKeyboard() {
  const rows: { id: string; label: string; style?: "default" | "ghost" | "primary"; wide?: boolean }[][] = [];
  for (let i = 0; i < DEPOSITS.length; i += 2) {
    const row = [
      { id: `dep:${DEPOSITS[i]}`, label: `${DEPOSITS[i]} USDT` },
    ];
    if (DEPOSITS[i + 1]) row.push({ id: `dep:${DEPOSITS[i + 1]}`, label: `${DEPOSITS[i + 1]} USDT` });
    rows.push(row);
  }
  rows.push([{ id: "home", label: "Back", style: "ghost" }]);
  return rows;
}

function catalogKeyboard(balanceCents: number, prices: Settings["prices"]) {
  const rows: { id: string; label: string; style?: "default" | "ghost" }[][] = [];
  const denoms: Denom[] = [10, 20, 25, 50, 100];
  for (const d of denoms) {
    const usdt = priceFor(prices, d);
    const need = Math.round(usdt * 100);
    rows.push([
      {
        id: `denom:${d}`,
        label: balanceCents >= need ? `$${d} · ${usdt.toFixed(2)} USDT` : `$${d} · need ${usdt.toFixed(2)}`,
        style: balanceCents >= need ? ("default" as const) : ("ghost" as const),
      },
    ]);
  }
  rows.push([{ id: "deposit", label: "Deposit" }]);
  rows.push([{ id: "home", label: "Back", style: "ghost" }]);
  return rows;
}

function welcomeMessage(): ChatMessage {
  return {
    id: "m-welcome",
    from: "bot",
    at: 0,
    kind: "text",
    text: "Goldroom\nOfficial Razer Gold US gift cards.\n\nPay with USDT on BEP20. Your code is delivered in this chat.\n\nDeposit to add funds, then buy.",
    keyboard: homeKeyboard(),
  };
}

export const useShop = create<ShopState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      settings: DEFAULT_SETTINGS,
      pins: seedPins(),
      orders: [],
      seq: 1,
      balanceCents: 0,
      messages: [welcomeMessage()],
      screen: { name: "home" },
      typing: false,

      patchSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),

      setPrice: (denom, usdt) =>
        set((s) => ({
          settings: {
            ...s.settings,
            prices: s.settings.prices.map((p) =>
              p.denom === denom ? { ...p, usdt } : p,
            ),
          },
        })),

      addPins: (raw) => {
        const errors: string[] = [];
        const added: Pin[] = [];
        const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/[,\s|]+/).filter(Boolean);
          const denom = Number(parts[0]) as Denom;
          const pin = parts[1];
          const serial = parts[2] ?? `SN-${nid()}`;
          if (![10, 20, 25, 50, 100].includes(denom) || !pin) {
            errors.push(line);
            continue;
          }
          added.push({ id: nid("pin"), denom, pin, serial, status: "stock" });
        }
        if (added.length) set((s) => ({ pins: [...s.pins, ...added] }));
        return { added: added.length, errors };
      },

      resetDemo: () => {
        set({
          pins: seedPins(),
          orders: [],
          seq: 1,
          balanceCents: 0,
          messages: [],
          screen: { name: "home" },
          typing: false,
        });
        get().startChat();
      },

      stockCount: (denom) => {
        const pins = get().pins;
        return pins.filter(
          (p) => p.status === "stock" && (denom == null || p.denom === denom),
        ).length;
      },

      expireStale: () => {
        const now = Date.now();
        set((s) => {
          const expired = s.orders.filter(
            (o) => o.status === "awaiting" && o.expiresAt < now,
          );
          if (!expired.length) return s;
          const ids = new Set(expired.map((o) => o.id));
          return {
            orders: s.orders.map((o) =>
              ids.has(o.id) ? { ...o, status: "expired" as const } : o,
            ),
          };
        });
      },

      startChat: () => {
        set({
          screen: { name: "home" },
          typing: false,
          messages: [welcomeMessage()],
        });
      },

      sendText: (text) => {
        const t = text.trim();
        if (!t) return;
        const lower = t.toLowerCase();
        if (lower === "/start" || lower === "hi" || lower === "hello") {
          get().tap("home");
          return;
        }
        if (lower === "deposit") {
          get().tap("deposit");
          return;
        }
        if (lower === "/buy" || lower === "buy") {
          get().tap("buy");
          return;
        }
        if (lower === "balance") {
          get().tap("balance");
          return;
        }
        if (lower === "/orders" || lower === "orders") {
          get().tap("orders");
          return;
        }
        if (lower === "/help" || lower === "help") {
          get().tap("help");
          return;
        }
        const usdt = t.match(/^(\d+(?:\.\d{1,2})?)\s*usdt$/i);
        if (usdt) {
          get().tap(`dep:${usdt[1]}`);
          return;
        }
        const asNum = Number(t.replace("$", ""));
        if ([10, 20, 25, 50, 100].includes(asNum)) {
          get().tap(`denom:${asNum}`);
          return;
        }
        if (DEPOSITS.includes(asNum) || (asNum >= 5 && asNum <= 500)) {
          get().tap(`dep:${asNum}`);
          return;
        }
        set((s) => ({
          messages: [
            ...s.messages,
            userMsg(t),
            botMsg({
              kind: "text",
              text: "Use the buttons below, or type deposit, buy, balance, or help.",
              keyboard: homeKeyboard(),
            }),
          ],
          screen: { name: "home" },
        }));
      },

      tap: (action) => {
        const state = get();
        state.expireStale();

        if (action === "home") {
          set((s) => ({
            screen: { name: "home" },
            messages: [
              ...s.messages,
              userMsg("Menu"),
              botMsg({
                kind: "text",
                text: "What do you need?",
                keyboard: homeKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action === "deposit") {
          set((s) => ({
            screen: { name: "deposit" },
            messages: [
              ...s.messages,
              userMsg("Deposit"),
              botMsg({
                kind: "text",
                text: "Choose a deposit amount, or type one — for example 40 USDT.\n\nSend USDT on BEP20. Use the exact amount shown.",
                keyboard: depositKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action === "balance") {
          set((s) => ({
            messages: [
              ...s.messages,
              userMsg("Balance"),
              botMsg({
                kind: "text",
                text: `Goldroom balance: ${money(s.balanceCents)} USDT`,
                keyboard: homeKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action === "buy" || action === "catalog") {
          set((s) => ({
            screen: { name: "catalog" },
            messages: [
              ...s.messages,
              userMsg("Buy Razer Gold"),
              botMsg({
                kind: "text",
                text:
                  s.balanceCents <= 0
                    ? "Your balance is 0.00 USDT. Deposit to continue."
                    : `Razer Gold US\nBalance: ${money(s.balanceCents)} USDT\n\nChoose an amount.`,
                keyboard: catalogKeyboard(s.balanceCents, s.settings.prices),
              }),
            ],
          }));
          return;
        }

        if (action === "help") {
          set((s) => ({
            screen: { name: "help" },
            messages: [
              ...s.messages,
              userMsg("How it works"),
              botMsg({
                kind: "text",
                text: "Buy Razer Gold US in three steps.\n\n1. Deposit USDT on BEP20 — send the exact amount shown.\n2. When your balance updates, tap Buy Razer Gold.\n3. Your PIN arrives in this chat.\n\nRedeem at gold.razer.com → Reload → Razer Gold PIN.\nCodes are final once revealed.",
                keyboard: homeKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action === "orders") {
          const mine = get().orders.slice().reverse();
          const lines =
            mine.length === 0
              ? "No deposits or cards yet."
              : mine
                  .slice(0, 8)
                  .map((o) =>
                    o.kind === "deposit"
                      ? `${o.id}  ·  ${o.payAmount} ${o.payAsset}  ·  ${o.status}`
                      : `${o.id}  ·  $${o.denom}  ·  ${o.status}`,
                  )
                  .join("\n");
          set((s) => ({
            screen: { name: "orders" },
            messages: [
              ...s.messages,
              userMsg("My orders"),
              botMsg({ kind: "text", text: lines, keyboard: homeKeyboard() }),
            ],
          }));
          return;
        }

        if (action.startsWith("dep:")) {
          const base = Number(action.slice(4));
          if (!Number.isFinite(base) || base <= 0) return;
          const { settings, seq } = get();
          const pay = uniquePayAmount(base, seq, "usdt-bep20", settings.btcUsd);
          const order: Order = {
            id: nextOrderId(seq),
            kind: "deposit",
            createdAt: Date.now(),
            expiresAt: Date.now() + ORDER_TTL_MS,
            network: "usdt-bep20",
            payAmount: pay.amount,
            payAsset: "USDT",
            address: settings.wallets["usdt-bep20"],
            status: "awaiting",
            creditCents: Math.round(Number(pay.amount) * 100),
          };
          set((s) => ({
            seq: s.seq + 1,
            orders: [...s.orders, order],
            screen: { name: "pay", orderId: order.id },
            messages: [
              ...s.messages,
              userMsg(`${base} USDT`),
              botMsg({
                kind: "pay",
                orderId: order.id,
                text: `Send exactly ${pay.amount} USDT`,
                keyboard: [
                  [{ id: `paid:${order.id}`, label: "I’ve paid", style: "primary", wide: true }],
                  [{ id: `cancel:${order.id}`, label: "Cancel", style: "ghost" }],
                ],
              }),
            ],
          }));
          return;
        }

        if (action.startsWith("denom:")) {
          const denom = Number(action.slice(6)) as Denom;
          const need = Math.round(priceFor(get().settings.prices, denom) * 100);
          if (get().balanceCents < need) {
            set((s) => ({
              messages: [
                ...s.messages,
                userMsg(`$${denom}`),
                botMsg({
                  kind: "text",
                  text: `Need ${money(need)} USDT for $${denom}. You have ${money(s.balanceCents)}.\nDeposit first.`,
                  keyboard: depositKeyboard(),
                }),
              ],
              screen: { name: "deposit" },
            }));
            return;
          }
          const pin = get().pins.find((p) => p.status === "stock" && p.denom === denom);
          const demoPin = pin?.pin ?? `0000${denom}99999999`;
          const demoSerial = pin?.serial ?? `FZ-${denom}`;
          const order: Order = {
            id: nextOrderId(get().seq),
            kind: "card",
            createdAt: Date.now(),
            expiresAt: Date.now() + ORDER_TTL_MS,
            denom,
            network: "usdt-bep20",
            payAmount: money(need),
            payAsset: "USDT",
            address: "",
            status: "delivered",
            pin: demoPin,
            serial: demoSerial,
            pinId: pin?.id,
            deliveredAt: Date.now(),
          };
          set((s) => ({
            seq: s.seq + 1,
            balanceCents: s.balanceCents - need,
            pins: pin
              ? s.pins.map((p) => (p.id === pin.id ? { ...p, status: "sold" as const } : p))
              : s.pins,
            orders: [...s.orders, order],
            screen: { name: "done", orderId: order.id },
            messages: [
              ...s.messages,
              userMsg(`Razer Gold $${denom}`),
              botMsg({
                kind: "pin",
                orderId: order.id,
                text: `Your PIN is below — keep this message.\nSpent ${money(need)} USDT. Balance: ${money(s.balanceCents - need)} USDT`,
                keyboard: [[{ id: "buy", label: "Buy another", style: "primary", wide: true }]],
              }),
            ],
          }));
          return;
        }

        if (action.startsWith("paid:")) {
          get().confirmPayment(action.slice(5));
          return;
        }
        if (action.startsWith("cancel:")) {
          get().cancelOrder(action.slice(7));
        }
      },

      confirmPayment: (orderId) => {
        const order = get().orders.find((o) => o.id === orderId);
        if (!order || (order.status !== "awaiting" && order.status !== "checking")) {
          return;
        }
        const auto = get().settings.autoConfirm;

        if (order.status === "awaiting") {
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === orderId ? { ...o, status: "checking" as const } : o,
            ),
            messages: [
              ...s.messages,
              userMsg("I’ve paid"),
              botMsg({
                kind: "status",
                orderId,
                text: auto
                  ? "Payment received. We're confirming it now…"
                  : "Payment received. We're confirming it now. Your balance will update shortly.",
              }),
            ],
          }));
          if (!auto) return;
          globalThis.setTimeout(() => {
            const current = get().orders.find((o) => o.id === orderId);
            if (current?.status === "checking") get().confirmPayment(orderId);
          }, 2400);
          return;
        }

        const credit = order.creditCents ?? Math.round(Number(order.payAmount) * 100);
        set((s) => ({
          balanceCents: s.balanceCents + credit,
          orders: s.orders.map((o) =>
            o.id === orderId ? { ...o, status: "credited" as const } : o,
          ),
          screen: { name: "home" },
          messages: [
            ...s.messages,
            botMsg({
              kind: "text",
              text: `Deposit ${orderId} confirmed.\nBalance: ${money(s.balanceCents + credit)} USDT\n\nYou can buy Razer Gold US now.`,
              keyboard: homeKeyboard(),
            }),
          ],
        }));
      },

      cancelOrder: (orderId) => {
        const order = get().orders.find((o) => o.id === orderId);
        if (!order || (order.status !== "awaiting" && order.status !== "checking")) {
          return;
        }
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id === orderId ? { ...o, status: "cancelled" as const } : o,
          ),
          screen: { name: "home" },
          messages: [
            ...s.messages,
            userMsg("Cancel"),
            botMsg({
              kind: "text",
              text: `${orderId} cancelled. Nothing was credited.`,
              keyboard: homeKeyboard(),
            }),
          ],
        }));
      },
    }),
    {
      name: "goldroom-v4",
      skipHydration: true,
      partialize: (s) => ({
        settings: s.settings,
        pins: s.pins,
        orders: s.orders,
        seq: s.seq,
        balanceCents: s.balanceCents,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

let hydrateStarted = false;

export function hydrateShop(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void Promise.resolve(useShop.persist.rehydrate()).finally(() => {
    useShop.getState().setHydrated(true);
    if (useShop.getState().messages.length === 0) {
      useShop.getState().startChat();
    }
    void getLiveWallets().then((wallets) => {
      const keys = Object.keys(wallets) as Network[];
      if (!keys.length) return;
      const current = useShop.getState().settings.wallets;
      const next = { ...current };
      let changed = false;
      for (const k of keys) {
        const v = wallets[k];
        if (v && v !== current[k]) {
          next[k] = v;
          changed = true;
        }
      }
      if (changed) useShop.getState().patchSettings({ wallets: next });
    });
  });
}
