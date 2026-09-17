import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { NETWORK_META, prettyPin } from "@/lib/catalog";
import { useShop } from "@/lib/store";
import type { ChatMessage, KeyboardButton, Order } from "@/lib/types";
import { cn, formatClock, shortAddr } from "@/lib/utils";
import { Ingot } from "../mark";

export function ChatPhone() {
  const messages = useShop((s) => s.messages);
  const tap = useShop((s) => s.tap);
  const sendText = useShop((s) => s.sendText);
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const lastBot = [...messages].reverse().find((m) => m.from === "bot");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    sendText(t);
    setDraft("");
  }

  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div className="rounded-2xl bg-bg-subtle p-2 shadow-[var(--shadow-border)] sm:rounded-[32px] sm:p-3">
        <div className="relative flex h-[min(720px,78dvh)] min-h-[520px] flex-col overflow-hidden rounded-xl bg-chat sm:rounded-[22px]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2 sm:pt-3">
            <div className="h-4 w-20 rounded-full bg-bg-elevated/80 sm:h-5 sm:w-24" />
          </div>

          <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-7 sm:pt-8">
            <div className="flex size-9 items-center justify-center rounded-full bg-bg-subtle">
              <Ingot className="h-4 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">Goldroom</p>
              <p className="text-xs text-muted">bot · private desk</p>
            </div>
            <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ok">
              Live demo
            </span>
          </header>

          <div
            ref={scroller}
            className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
          >
            {messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
          </div>

          {lastBot?.keyboard && lastBot.keyboard.length > 0 && (
            <div className="border-t border-border bg-bg-elevated/60 px-3 py-2">
              <Keyboard rows={lastBot.keyboard} onTap={tap} />
            </div>
          )}

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-border bg-bg-elevated px-3 py-2.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="buy · orders · help"
              className="h-10 min-w-0 flex-1 rounded-md bg-bg-subtle px-3 text-sm text-fg outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_1px_var(--color-border-strong)]"
              aria-label="Message Goldroom"
            />
            <button
              type="submit"
              className="flex size-10 items-center justify-center rounded-md bg-accent text-accent-fg transition-transform duration-(--motion-quick) active:scale-[0.96]"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Keyboard({
  rows,
  onTap,
}: {
  rows: KeyboardButton[][];
  onTap: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          {row.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => onTap(btn.id)}
              className={cn(
                "min-h-10 flex-1 rounded-md px-2 text-[13px] font-medium leading-tight transition-[opacity,transform] duration-(--motion-quick) active:scale-[0.96]",
                btn.style === "primary" && "bg-accent text-accent-fg",
                btn.style === "ghost" && "bg-transparent text-muted shadow-[0_0_0_1px_var(--color-border)]",
                btn.style === "danger" && "bg-danger/15 text-danger",
                (!btn.style || btn.style === "default") &&
                  "bg-bg-subtle text-fg shadow-[0_0_0_1px_var(--color-border)]",
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.from === "user";
  const order = useShop((s) =>
    message.orderId ? s.orders.find((o) => o.id === message.orderId) : undefined,
  );

  return (
    <div className={cn("flex msg-enter", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-lg px-3 py-2.5 text-sm leading-relaxed",
          mine
            ? "rounded-br-xs bg-bubble-user text-fg"
            : "rounded-bl-xs bg-bubble-bot text-fg",
        )}
      >
        {message.text && (
          <p
            className={cn(
              "whitespace-pre-wrap",
              message.kind === "status" &&
                order?.status === "checking" &&
                "shimmer-text",
            )}
          >
            {message.text}
          </p>
        )}
        {message.kind === "pay" && order && <PayCard order={order} />}
        {message.kind === "pin" && order && <PinCard order={order} />}
      </div>
    </div>
  );
}

function PayCard({ order }: { order: Order }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const meta = NETWORK_META[order.network] ?? {
    label: order.payAsset,
    chain: "BEP20",
    asset: order.payAsset,
    hint: "",
  };
  const left = order.expiresAt - now;

  return (
    <div className="mt-3 space-y-2 rounded-md bg-bg-elevated p-3 shadow-[var(--shadow-border)]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-lg tabular-nums tracking-tight">
          {order.payAmount}{" "}
          <span className="text-sm text-muted">{order.payAsset}</span>
        </p>
        <p className="text-xs tabular-nums text-muted">
          {left > 0 ? formatClock(left) : "Expired"}
        </p>
      </div>
      <Row label="Network" value={`${meta.label} · ${meta.chain}`} />
      <Row label="Order" value={order.id} />
      <Row label="To" value={shortAddr(order.address, 10, 8)} copy={order.address} />
      <CopyRow label="Amount" value={order.payAmount} />
      <p className="pt-1 text-[11px] leading-snug text-subtle">
        BEP20 USDT only. TRC20 or ERC20 will not land. Send the exact amount —
        matching cents identify this order.
      </p>
    </div>
  );
}

function PinCard({ order }: { order: Order }) {
  if (!order.pin) return null;
  return (
    <div className="mt-3 space-y-2 rounded-md bg-bg-elevated p-3 shadow-[var(--shadow-border)]">
      <p className="text-[11px] uppercase tracking-wider text-brass">
        Razer Gold US · ${order.denom}
      </p>
      <CopyRow label="PIN" value={prettyPin(order.pin)} raw={order.pin} />
      {order.serial && <CopyRow label="Serial" value={order.serial} />}
      <p className="pt-1 text-[11px] leading-snug text-subtle">
        Demo PIN — not redeemable. Live desk delivers a real Razer code after
        chain confirm.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <button
        type="button"
        className="text-right font-mono text-fg"
        onClick={() => {
          if (!copy) return;
          void navigator.clipboard.writeText(copy);
          toast("Address copied");
        }}
      >
        {value}
      </button>
    </div>
  );
}

function CopyRow({
  label,
  value,
  raw,
}: {
  label: string;
  value: string;
  raw?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[11px] text-muted">{label}</p>
        <p className="font-mono text-sm tabular-nums">{value}</p>
      </div>
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(raw ?? value.replace(/\s/g, ""));
          setCopied(true);
          toast(`${label} copied`);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
