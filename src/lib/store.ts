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

type ShopState = {
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  settings: Settings;
  pins: Pin[];
  orders: Order[];
  seq: number;
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
    [{ id: "buy", label: "Buy Razer Gold", style: "primary" as const, wide: true }],
    [
      { id: "orders", label: "Orders" },
      { id: "help", label: "Help" },
    ],
  ];
}

function welcomeMessage(): ChatMessage {
  return {
    id: "m-welcome",
    from: "bot",
    at: 0,
    kind: "text",
    text: "Goldroom\nPrivate desk for Razer Gold US.\n\nPay in crypto. PIN arrives in this chat.\nTap below to buy.",
    keyboard: homeKeyboard(),
  };
}

function catalogKeyboard(stockOf: (d: Denom) => number, prices: Settings["prices"]) {
  const rows: { id: string; label: string; style?: "default" | "ghost" }[][] = [];
  const denoms: Denom[] = [10, 20, 25, 50, 100];
  for (const d of denoms) {
    const left = stockOf(d);
    const usdt = priceFor(prices, d);
    rows.push([
      {
        id: `denom:${d}`,
        label: left > 0 ? `$${d} · ${usdt.toFixed(2)} USDT` : `$${d} · sold out`,
        style: left > 0 ? ("default" as const) : ("ghost" as const),
      },
    ]);
  }
  rows.push([{ id: "home", label: "Back", style: "ghost" }]);
  return rows;
}

function networkKeyboard() {
  return [
    [{ id: "net:usdt-bep20", label: "USDT · BEP20", style: "primary" as const, wide: true }],
    [{ id: "net:btc", label: "Bitcoin" }],
    [{ id: "catalog", label: "Back", style: "ghost" as const }],
  ];
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
        const lines = raw
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/[,\s|]+/).filter(Boolean);
          const denom = Number(parts[0]) as Denom;
          const pin = parts[1];
          const serial = parts[2] ?? `SN-${nid()}`;
          if (![10, 20, 25, 50, 100].includes(denom) || !pin) {
            errors.push(line);
            continue;
          }
          added.push({
            id: nid("pin"),
            denom,
            pin,
            serial,
            status: "stock",
          });
        }
        if (added.length) {
          set((s) => ({ pins: [...s.pins, ...added] }));
        }
        return { added: added.length, errors };
      },

      resetDemo: () => {
        set({
          pins: seedPins(),
          orders: [],
          seq: 1,
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
            pins: s.pins.map((p) =>
              p.status === "reserved" && p.orderId && ids.has(p.orderId)
                ? { ...p, status: "stock" as const, orderId: undefined }
                : p,
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
        if (lower === "/buy" || lower === "buy") {
          get().tap("buy");
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
        const asNum = Number(t.replace("$", ""));
        if ([10, 20, 25, 50, 100].includes(asNum)) {
          get().tap(`denom:${asNum}`);
          return;
        }
        set((s) => ({
          messages: [
            ...s.messages,
            userMsg(t),
            botMsg({
              kind: "text",
              text: "Use the buttons below, or type buy, orders, or help.",
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

        if (action === "buy" || action === "catalog") {
          const left = get().stockCount();
          const body =
            left === 0
              ? "Stock is empty. The desk will restock shortly."
              : "Razer Gold · United States\n\nPINs redeem at gold.razer.com.\nDelivered in chat after payment confirms.\n\nPick an amount.";
          set((s) => ({
            screen: { name: "catalog" },
            messages: [
              ...s.messages,
              userMsg(action === "catalog" ? "Amounts" : "Buy Razer Gold"),
              botMsg({
                kind: "text",
                text: body,
                keyboard: catalogKeyboard(get().stockCount, s.settings.prices),
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
                text:
                  "Four steps.\n\n1. Pick a Razer Gold US amount.\n2. Pay in USDT on BEP20 (BNB Smart Chain — not TRC20, not ERC20).\n3. Send the exact amount shown — the extra cents are how we match your payment.\n4. Tap I’ve paid. The PIN lands in this chat.\n\nRedeem at gold.razer.com → Reload → Razer Gold PIN.\nUS PINs only. No refunds once the code is revealed.",
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
              ? "No orders yet."
              : mine
                  .slice(0, 8)
                  .map((o) => `${o.id}  ·  $${o.denom}  ·  ${o.status}`)
                  .join("\n");
          set((s) => ({
            screen: { name: "orders" },
            messages: [
              ...s.messages,
              userMsg("My orders"),
              botMsg({
                kind: "text",
                text: lines,
                keyboard: homeKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action.startsWith("denom:")) {
          const denom = Number(action.slice(6)) as Denom;
          const left = get().stockCount(denom);
          const usdt = priceFor(get().settings.prices, denom);
          if (left === 0) {
            set((s) => ({
              messages: [
                ...s.messages,
                userMsg(`$${denom}`),
                botMsg({
                  kind: "text",
                  text: `$${denom} is out of stock. Pick another amount.`,
                  keyboard: catalogKeyboard(get().stockCount, s.settings.prices),
                }),
              ],
              screen: { name: "catalog" },
            }));
            return;
          }
          set((s) => ({
            screen: { name: "network", denom },
            messages: [
              ...s.messages,
              userMsg(`Razer Gold $${denom}`),
              botMsg({
                kind: "text",
                text: `Razer Gold US · $${denom}\nYou pay ${usdt.toFixed(2)} USDT on BEP20 (plus matching cents).\n\n${s.settings.markupNote}\n\nBEP20 only — TRC20 or ERC20 will not arrive.`,
                keyboard: networkKeyboard(),
              }),
            ],
          }));
          return;
        }

        if (action.startsWith("net:")) {
          const network = action.slice(4) as Network;
          const screen = get().screen;
          const denom = screen.name === "network" ? screen.denom : undefined;
          if (!denom) {
            get().tap("buy");
            return;
          }
          const pin = get().pins.find((p) => p.status === "stock" && p.denom === denom);
          if (!pin) {
            get().tap("buy");
            return;
          }
          const { settings, seq } = get();
          const pay = uniquePayAmount(
            priceFor(settings.prices, denom),
            seq,
            network,
            settings.btcUsd,
          );
          const order: Order = {
            id: nextOrderId(seq),
            createdAt: Date.now(),
            expiresAt: Date.now() + ORDER_TTL_MS,
            denom,
            network,
            payAmount: pay.amount,
            payAsset: pay.asset,
            address: settings.wallets[network],
            status: "awaiting",
            pinId: pin.id,
          };
          set((s) => ({
            seq: s.seq + 1,
            pins: s.pins.map((p) =>
              p.id === pin.id ? { ...p, status: "reserved", orderId: order.id } : p,
            ),
            orders: [...s.orders, order],
            screen: { name: "pay", orderId: order.id },
            messages: [
              ...s.messages,
              userMsg(network === "btc" ? "Bitcoin" : "USDT · BEP20"),
              botMsg({
                kind: "pay",
                orderId: order.id,
                text: `Send exactly ${pay.amount} ${pay.asset}`,
                keyboard: [
                  [
                    { id: `paid:${order.id}`, label: "I’ve paid", style: "primary", wide: true },
                  ],
                  [{ id: `cancel:${order.id}`, label: "Cancel", style: "ghost" }],
                ],
              }),
            ],
          }));
          return;
        }

        if (action.startsWith("paid:")) {
          const orderId = action.slice(5);
          get().confirmPayment(orderId);
          return;
        }

        if (action.startsWith("cancel:")) {
          get().cancelOrder(action.slice(7));
          return;
        }

        if (action === "buy_again") {
          get().tap("buy");
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
                  ? "Checking the chain for the exact amount…"
                  : "Payment flagged. The desk will confirm and send your PIN here.",
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

        const pin = get().pins.find((p) => p.id === order.pinId);
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: "delivered" as const,
                  pin: pin?.pin,
                  serial: pin?.serial,
                  deliveredAt: Date.now(),
                }
              : o,
          ),
          pins: s.pins.map((p) =>
            p.id === order.pinId ? { ...p, status: "sold" as const } : p,
          ),
          screen: { name: "done", orderId },
          messages: [
            ...s.messages,
            botMsg({
              kind: "pin",
              orderId,
              text: "Payment received. Your PIN is below — keep this message.",
              keyboard: [
                [{ id: "buy_again", label: "Buy another", style: "primary", wide: true }],
              ],
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
          pins: s.pins.map((p) =>
            p.id === order.pinId
              ? { ...p, status: "stock" as const, orderId: undefined }
              : p,
          ),
          screen: { name: "home" },
          messages: [
            ...s.messages,
            userMsg("Cancel"),
            botMsg({
              kind: "text",
              text: `${orderId} cancelled. Nothing was sent.`,
              keyboard: homeKeyboard(),
            }),
          ],
        }));
      },
    }),
    {
      name: "goldroom-v3",
      skipHydration: true,
      partialize: (s) => ({
        settings: s.settings,
        pins: s.pins,
        orders: s.orders,
        seq: s.seq,
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
