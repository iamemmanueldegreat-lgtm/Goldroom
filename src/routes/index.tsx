import { createFileRoute, Link } from "@tanstack/react-router";
import { ChatPhone } from "@/components/chat/phone";
import { Shell } from "@/components/shell";
import { Ingot } from "@/components/mark";
import { useShop } from "@/lib/store";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const balanceCents = useShop((s) => s.balanceCents);
  const prices = useShop((s) => s.settings.prices);

  return (
    <Shell>
      <main className="mx-auto flex max-w-6xl flex-col-reverse gap-8 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[1fr_400px] lg:items-start lg:gap-16 lg:py-14">
        <section className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brass">
            Private desk
          </p>
          <h1 className="mt-4 font-display text-[2.6rem] leading-[1.1] tracking-[-0.03em] text-fg sm:text-5xl">
            Razer Gold US, paid in crypto, delivered in chat.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted">
            Goldroom is a quiet shop for a small group. Deposit USDT on BEP20,
            the desk funds Fazer, then you buy a Razer Gold US PIN from your
            balance. Same flow as the Telegram bot.
          </p>

          <ol className="mt-8 space-y-4">
            {[
              {
                n: "01",
                t: "Deposit USDT",
                d: "Send the exact BEP20 amount. Matching cents identify the deposit.",
              },
              {
                n: "02",
                t: "Desk funds Fazer",
                d: "After the supplier balance is up, your Goldroom balance is credited.",
              },
              {
                n: "03",
                t: "Buy a PIN",
                d: "Spend that balance on Razer Gold US. The code lands in chat.",
              },
            ].map((step) => (
              <li key={step.n} className="flex gap-4">
                <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-brass">
                  {step.n}
                </span>
                <div>
                  <p className="text-sm font-medium text-fg">{step.t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{step.d}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 rounded-xl bg-bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Desk prices</p>
              <p className="font-mono text-xs tabular-nums text-muted">
                {(balanceCents / 100).toFixed(2)} USDT on the book
              </p>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {prices.map((p) => (
                <li
                  key={p.denom}
                  className="rounded-md bg-bg-subtle px-3 py-3 text-center"
                >
                  <p className="font-display text-xl leading-none text-fg">
                    {formatUsd(p.denom)}
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted">
                    {p.usdt.toFixed(2)} USDT
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 text-sm text-subtle">
            This preview is a working demo. PINs here are marked DEMO and will
            not redeem.{" "}
            <Link to="/backoffice" className="text-muted underline-offset-4 hover:text-fg hover:underline">
              Open the back office
            </Link>{" "}
            to restock, set prices, and check which Secrets the server can see.
          </p>
        </section>

        <section className="lg:sticky lg:top-24">
          <ChatPhone />
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-subtle">
            <Ingot className="h-3.5 w-5" />
            Try the shop — tap Buy Razer Gold.
          </p>
        </section>
      </main>
    </Shell>
  );
}
