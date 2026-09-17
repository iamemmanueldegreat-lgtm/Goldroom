import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { NETWORK_META, maskPin } from "@/lib/catalog";
import { getLiveWallets, getSecretStatus, type SecretRow } from "@/lib/secrets";
import { useShop } from "@/lib/store";
import type { Denom, Network, OrderStatus } from "@/lib/types";
import { DENOMS } from "@/lib/types";
import { cn, formatWhen } from "@/lib/utils";

export const Route = createFileRoute("/backoffice")({
  loader: async () => {
    const [status, wallets] = await Promise.all([
      getSecretStatus(),
      getLiveWallets(),
    ]);
    return { status, wallets };
  },
  component: BackOffice,
});

const STATUS_TONE: Record<OrderStatus, string> = {
  awaiting: "text-warn",
  checking: "text-warn",
  paid: "text-ok",
  delivered: "text-ok",
  cancelled: "text-subtle",
  expired: "text-subtle",
};

function BackOffice() {
  const [tab, setTab] = useState<"orders" | "stock" | "settings" | "secrets">(
    "secrets",
  );

  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brass">
              Operator
            </p>
            <h1 className="mt-2 font-display text-4xl tracking-tight">Back office</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Stock, prices, and your BEP20 pay-in address. Bot tokens stay off
              this page — they go in Railway when we wire the live bot.
            </p>
          </div>
          <Stats />
        </div>

        <div className="mt-8 flex gap-1 rounded-lg bg-bg-elevated p-1 shadow-[var(--shadow-border)]">
          {(
            [
              ["secrets", "Secrets"],
              ["orders", "Orders"],
              ["stock", "Stock"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "h-10 flex-1 rounded-md text-sm font-medium transition-colors duration-(--motion-quick)",
                tab === id ? "bg-bg-subtle text-fg" : "text-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "secrets" && <SecretsPanel />}
          {tab === "orders" && <OrdersPanel />}
          {tab === "stock" && <StockPanel />}
          {tab === "settings" && <SettingsPanel />}
        </div>
      </main>
    </Shell>
  );
}

function SecretsPanel() {
  const { status: rows, wallets: live } = Route.useLoaderData();

  const groups: { id: SecretRow["group"]; title: string; note: string }[] = [
    {
      id: "telegram",
      title: "Telegram",
      note: "BotFather token plus your numeric Telegram user id. The worker uses these on Railway — the browser never sees them.",
    },
    {
      id: "cards",
      title: "Card supplier",
      note: "The key that buys Razer Gold US PINs. Optional secret if your provider uses two parts.",
    },
    {
      id: "data",
      title: "Supabase",
      note: "Service role only. Never the anon key in the shop. Orders and PINs stay on the server.",
    },
    {
      id: "wallets",
      title: "Pay-in addresses",
      note: "Shown to buyers at checkout. Paste the BEP20 address in Settings — it is public, not a private key.",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-medium">Where keys go</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Variables on Railway do not start Telegram by themselves. The live
          bot is a worker: node bot/server.mjs. That file is now in this
          project — it still has to be the thing Railway runs.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          On the Goldroom service: Settings → one public domain if you want a
          health page, then confirm the start command is node bot/server.mjs.
          Add ADMIN_TELEGRAM_ID (your numeric user id from @userinfobot) so
          you can confirm payments. Never paste the bot token here.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          After a successful deploy, open your BotFather bot in Telegram and
          send /start. Stock PINs with /stock 25 PIN SERIAL — only you, the
          admin, can do that.
        </p>
      </section>

      {groups.map((g) => (
          <section
            key={g.id}
            className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]"
          >
            <h2 className="text-sm font-medium">{g.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">{g.note}</p>
            <ul className="mt-4 space-y-2">
              {rows
                .filter((r) => r.group === g.id)
                .map((r) => (
                  <SecretLine key={r.key} row={r} />
                ))}
            </ul>
          </section>
        ))}

      {Object.keys(live).length > 0 && (
        <p className="text-xs text-ok">
          Live pay-in addresses are loaded from Secrets and used at checkout.
        </p>
      )}
    </div>
  );
}

function SecretLine({ row }: { row: SecretRow }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-center gap-3 rounded-md bg-bg-subtle px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-fg">{row.key}</p>
        <p className="mt-0.5 text-xs text-muted">
          {row.label}
          {row.required ? "" : " · optional"}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          row.set ? "text-ok" : "text-warn",
        )}
      >
        {row.set ? "Set" : "Missing"}
      </span>
      <button
        type="button"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        aria-label={`Copy ${row.key}`}
        onClick={() => {
          void navigator.clipboard.writeText(row.key);
          setCopied(true);
          toast("Name copied");
          globalThis.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </li>
  );
}

function Stats() {
  const orders = useShop((s) => s.orders);
  const pins = useShop((s) => s.pins);
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const pending = orders.filter(
    (o) => o.status === "awaiting" || o.status === "checking",
  ).length;
  const stock = pins.filter((p) => p.status === "stock").length;

  return (
    <dl className="grid grid-cols-3 gap-3 sm:min-w-[320px]">
      {[
        { k: "Pending", v: pending },
        { k: "Delivered", v: delivered },
        { k: "In stock", v: stock },
      ].map((s) => (
        <div key={s.k} className="rounded-lg bg-bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
          <dt className="text-[11px] uppercase tracking-wide text-muted">{s.k}</dt>
          <dd className="mt-1 font-mono text-xl tabular-nums">{s.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrdersPanel() {
  const orders = useShop((s) => s.orders);
  const confirmPayment = useShop((s) => s.confirmPayment);
  const cancelOrder = useShop((s) => s.cancelOrder);
  const list = useMemo(() => orders.slice().reverse(), [orders]);

  if (!list.length) {
    return (
      <div className="rounded-xl bg-bg-elevated px-5 py-12 text-center shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted">No orders yet. Buy a PIN from the desk chat.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-bg-elevated shadow-[var(--shadow-border)]">
      <ul className="divide-y divide-border">
        {list.map((o) => {
          const meta = NETWORK_META[o.network];
          const actionable = o.status === "awaiting" || o.status === "checking";
          return (
            <li key={o.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-sm">
                  {o.id}
                  <span className="text-muted"> · ${o.denom}</span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  {o.payAmount} {o.payAsset} · {meta.chain} · {formatWhen(o.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-xs font-medium capitalize", STATUS_TONE[o.status])}>
                  {o.status}
                </span>
                {actionable && (
                  <>
                    <Button size="sm" onClick={() => confirmPayment(o.id)}>
                      Confirm paid
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelOrder(o.id)}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StockPanel() {
  const pins = useShop((s) => s.pins);
  const addPins = useShop((s) => s.addPins);
  const resetDemo = useShop((s) => s.resetDemo);
  const [raw, setRaw] = useState("");

  const counts = DENOMS.map((d) => ({
    denom: d,
    stock: pins.filter((p) => p.denom === d && p.status === "stock").length,
    reserved: pins.filter((p) => p.denom === d && p.status === "reserved").length,
    sold: pins.filter((p) => p.denom === d && p.status === "sold").length,
  }));

  function onAdd() {
    const result = addPins(raw);
    if (result.added) {
      toast(`Added ${result.added} PIN${result.added === 1 ? "" : "s"}`);
      setRaw("");
    }
    if (result.errors.length) {
      toast(`${result.errors.length} line${result.errors.length === 1 ? "" : "s"} skipped`);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">By amount</p>
        <ul className="mt-4 space-y-2">
          {counts.map((c) => (
            <li
              key={c.denom}
              className="flex items-center justify-between rounded-md bg-bg-subtle px-3 py-2.5 text-sm"
            >
              <span>${c.denom}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {c.stock} ready · {c.reserved} held · {c.sold} sold
              </span>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          className="mt-4 w-full"
          onClick={() => {
            resetDemo();
            toast("Demo reset");
          }}
        >
          Reset demo stock
        </Button>
      </div>

      <div className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Add PINs</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          One per line: amount, PIN, serial. Example{" "}
          <span className="font-mono text-fg">25 00715009912189 4038748228</span>
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={7}
          className="mt-3 w-full resize-y rounded-md bg-bg-subtle px-3 py-2.5 font-mono text-sm text-fg outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_1px_var(--color-border-strong)]"
          placeholder={"10 00001000000001 SN-1\n25 00002500000002 SN-2"}
        />
        <Button className="mt-3 w-full" onClick={onAdd} disabled={!raw.trim()}>
          Add to stock
        </Button>

        <p className="mt-6 text-xs font-medium uppercase tracking-wide text-muted">
          Recent codes
        </p>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {pins
            .slice()
            .reverse()
            .slice(0, 12)
            .map((p) => (
              <li
                key={p.id}
                className="flex justify-between font-mono text-xs text-muted"
              >
                <span>
                  ${p.denom} · {maskPin(p.pin)}
                </span>
                <span className="capitalize">{p.status}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const settings = useShop((s) => s.settings);
  const patchSettings = useShop((s) => s.patchSettings);
  const setPrice = useShop((s) => s.setPrice);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-medium">Sell prices (USDT)</h2>
        <p className="mt-1 text-xs text-muted">
          What the buyer pays. Face value stays the Razer PIN amount.
        </p>
        <ul className="mt-4 space-y-2">
          {settings.prices.map((p) => (
            <li key={p.denom} className="flex items-center gap-3">
              <span className="w-12 text-sm">${p.denom}</span>
              <input
                type="number"
                step="0.01"
                min={p.denom}
                value={p.usdt}
                onChange={(e) =>
                  setPrice(p.denom as Denom, Number(e.target.value) || p.denom)
                }
                className="h-10 flex-1 rounded-md bg-bg-subtle px-3 font-mono text-sm outline-none focus-visible:shadow-[0_0_0_1px_var(--color-border-strong)]"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-medium">Wallets</h2>
        <p className="mt-1 text-xs text-muted">
          Public pay-in addresses. Paste your BEP20 USDT address — not the
          private key. Buyers send to this. Wrong network (TRC20 / ERC20) will
          not arrive.
        </p>
        <ul className="mt-4 space-y-3">
          {(Object.keys(settings.wallets) as Network[]).map((n) => (
            <li key={n}>
              <label className="text-[11px] uppercase tracking-wide text-muted">
                {NETWORK_META[n].label} · {NETWORK_META[n].chain}
              </label>
              <input
                value={settings.wallets[n]}
                onChange={(e) =>
                  patchSettings({
                    wallets: { ...settings.wallets, [n]: e.target.value },
                  })
                }
                className="mt-1 h-10 w-full rounded-md bg-bg-subtle px-3 font-mono text-xs outline-none focus-visible:shadow-[0_0_0_1px_var(--color-border-strong)]"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)] lg:col-span-2">
        <h2 className="text-sm font-medium">How the desk runs</h2>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-brass"
            checked={settings.autoConfirm}
            onChange={(e) => patchSettings({ autoConfirm: e.target.checked })}
          />
          <span>
            Auto-confirm demo payments
            <span className="mt-1 block text-xs text-muted">
              On: tapping I’ve paid delivers a PIN after a short check. Off: you
              confirm from Orders — the live flow for a small group watching a
              wallet.
            </span>
          </span>
        </label>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-brass"
            checked={settings.allowlistOn}
            onChange={(e) => patchSettings({ allowlistOn: e.target.checked })}
          />
          <span>
            Private allowlist
            <span className="mt-1 block text-xs text-muted">
              When the Telegram bot is connected, only listed usernames can buy.
              The preview chat always lets you through.
            </span>
          </span>
        </label>
        <textarea
          value={settings.allowlist.join("\n")}
          onChange={(e) =>
            patchSettings({
              allowlist: e.target.value
                .split("\n")
                .map((x) => x.trim().replace(/^@/, ""))
                .filter(Boolean),
            })
          }
          rows={4}
          placeholder={"alice\nbob"}
          className="mt-3 w-full rounded-md bg-bg-subtle px-3 py-2.5 font-mono text-sm outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_1px_var(--color-border-strong)]"
        />

        <div className="mt-8 border-t border-border pt-5">
          <h3 className="text-sm font-medium">Tokens and API keys</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Not entered here, and not in this Grok chat. When the live Telegram
            bot is connected, those go in Railway Variables: TELEGRAM_BOT_TOKEN,
            WALLET_USDT_BEP20, CARD_API_KEY, SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY.
          </p>
        </div>
      </section>
    </div>
  );
}
