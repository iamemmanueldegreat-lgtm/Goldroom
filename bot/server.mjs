import http from "node:http";
import { Bot, InlineKeyboard, Keyboard } from "grammy";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const WALLET_BEP20 = (process.env.WALLET_USDT_BEP20 || "").trim();
const WALLET_BTC = (process.env.WALLET_BTC || "").trim();
const ADMIN_ID = Number((process.env.ADMIN_TELEGRAM_ID || "").trim()) || 0;
const ALLOWLIST = (process.env.ALLOWLIST || "")
  .split(/[,\s]+/)
  .map((s) => s.replace(/^@/, "").toLowerCase())
  .filter(Boolean);
const PORT = Number(process.env.PORT || 3000);
const ORDER_TTL_MS = 30 * 60 * 1000;
const PRICES = { 10: 11.5, 20: 22.8, 25: 28.2, 50: 55.5, 100: 109 };
const DENOMS = [10, 20, 25, 50, 100];

/** @typedef {"stock" | "reserved" | "sold"} PinStatus */
/** @typedef {"awaiting" | "checking" | "delivered" | "cancelled"} OrderStatus */

const desk = {
  seq: 1,
  /** @type {Array<{id: string, denom: number, pin: string, serial: string, status: PinStatus, orderId?: string}>} */
  pins: [],
  /** @type {Map<string, {id: string, chatId: number, username: string, denom: number, network: string, payAmount: string, payAsset: string, address: string, status: OrderStatus, pinId?: string, createdAt: number, expiresAt: number}>} */
  orders: new Map(),
  /** @type {Map<number, {screen: string, denom?: number, orderId?: string}>} */
  sessions: new Map(),
};

function nid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function nextOrderId() {
  const id = `GR-${String(1000 + desk.seq)}`;
  desk.seq += 1;
  return id;
}

function uniqueAmount(baseUsdt, seq, network) {
  const bump = 10 + (seq % 87);
  if (network === "btc") {
    const btcUsd = Number(process.env.BTC_USD || 64000);
    return { amount: ((baseUsdt + bump / 100) / btcUsd).toFixed(6), asset: "BTC" };
  }
  const cents = Math.round(baseUsdt * 100) + bump;
  return { amount: (cents / 100).toFixed(2), asset: "USDT" };
}

function stockCount(denom) {
  return desk.pins.filter((p) => p.status === "stock" && (!denom || p.denom === denom)).length;
}

function sessionOf(chatId) {
  if (!desk.sessions.has(chatId)) desk.sessions.set(chatId, { screen: "home" });
  return desk.sessions.get(chatId);
}

function homeKb() {
  return new Keyboard().text("Buy Razer Gold").row().text("Orders").text("Help").resized();
}

function catalogKb() {
  const kb = new Keyboard();
  for (const d of DENOMS) {
    const left = stockCount(d);
    const price = PRICES[d].toFixed(2);
    kb.text(left > 0 ? `$${d} · ${price} USDT` : `$${d} · sold out`).row();
  }
  kb.text("Back");
  return kb.resized();
}

function networkKb() {
  const kb = new Keyboard().text("USDT · BEP20");
  if (WALLET_BTC) kb.row().text("Bitcoin");
  kb.row().text("Back");
  return kb.resized();
}

function allowed(ctx) {
  if (!ALLOWLIST.length) return true;
  const u = (ctx.from?.username || "").toLowerCase();
  const id = String(ctx.from?.id || "");
  return ALLOWLIST.includes(u) || ALLOWLIST.includes(id);
}

function isAdmin(ctx) {
  return ADMIN_ID > 0 && ctx.from?.id === ADMIN_ID;
}

function expireStale() {
  const now = Date.now();
  for (const order of desk.orders.values()) {
    if (order.status === "awaiting" && order.expiresAt < now) {
      order.status = "cancelled";
      const pin = desk.pins.find((p) => p.id === order.pinId);
      if (pin && pin.status === "reserved") pin.status = "stock";
    }
  }
}

function prettyPin(pin) {
  return pin.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

async function sendHome(ctx, text) {
  sessionOf(ctx.chat.id).screen = "home";
  await ctx.reply(text, { reply_markup: homeKb() });
}

async function sendCatalog(ctx, intro) {
  expireStale();
  sessionOf(ctx.chat.id).screen = "catalog";
  const left = stockCount();
  const body =
    intro ||
    (left === 0
      ? "Stock is empty. The desk will restock shortly."
      : "Razer Gold · United States\n\nPINs redeem at gold.razer.com.\nDelivered in chat after payment confirms.\n\nPick an amount.");
  await ctx.reply(body, { reply_markup: catalogKb() });
}

function parseDenomLabel(text) {
  const m = text.match(/^\$(\d+)/);
  if (!m) return null;
  const d = Number(m[1]);
  return DENOMS.includes(d) ? d : null;
}

async function notifyAdmin(bot, text, extra = {}) {
  if (!ADMIN_ID) return;
  try {
    await bot.api.sendMessage(ADMIN_ID, text, extra);
  } catch (err) {
    console.error("admin notify failed", err instanceof Error ? err.message : err);
  }
}

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Health will run; bot will not.");
}

const bot = TOKEN ? new Bot(TOKEN) : null;

if (bot) {
  bot.use(async (ctx, next) => {
    if (ctx.from && !allowed(ctx) && !isAdmin(ctx)) {
      await ctx.reply("This desk is private.");
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await sendHome(
      ctx,
      "Goldroom\nPrivate desk for Razer Gold US.\n\nPay in USDT on BEP20. PIN arrives in this chat.\nTap below to buy.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Four steps.\n\n1. Pick a Razer Gold US amount.\n2. Pay in USDT on BEP20 (BNB Smart Chain — not TRC20, not ERC20).\n3. Send the exact amount shown — the extra cents are how we match your payment.\n4. Tap I’ve paid. The PIN lands in this chat after the desk confirms.\n\nRedeem at gold.razer.com → Reload → Razer Gold PIN.\nUS PINs only. No refunds once the code is revealed.",
      { reply_markup: homeKb() },
    );
  });

  bot.command("stock", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const body = (ctx.match || "").trim();
    if (!body) {
      const lines = DENOMS.map((d) => `$${d}  ·  ${stockCount(d)} in stock`).join("\n");
      await ctx.reply(
        `Stock\n${lines}\n\nAdd PINs with:\n/stock 25 PIN SERIAL\nOne per line after the command.`,
      );
      return;
    }
    const rows = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let added = 0;
    const errors = [];
    for (const line of rows) {
      const parts = line.split(/[,\s|]+/).filter(Boolean);
      const denom = Number(parts[0]);
      const pin = parts[1];
      const serial = parts[2] || nid("SN");
      if (!DENOMS.includes(denom) || !pin) {
        errors.push(line);
        continue;
      }
      desk.pins.push({
        id: nid("pin"),
        denom,
        pin,
        serial,
        status: "stock",
      });
      added += 1;
    }
    await ctx.reply(
      added ? `Added ${added} PIN${added === 1 ? "" : "s"}.` : "Nothing added.",
    );
    if (errors.length) await ctx.reply(`Skipped:\n${errors.join("\n")}`);
  });

  bot.command("orders", async (ctx) => {
    const mine = [...desk.orders.values()]
      .filter((o) => (isAdmin(ctx) ? true : o.chatId === ctx.chat.id))
      .slice(-8)
      .reverse();
    const lines =
      mine.length === 0
        ? "No orders yet."
        : mine.map((o) => `${o.id}  ·  $${o.denom}  ·  ${o.status}`).join("\n");
    await ctx.reply(lines, { reply_markup: homeKb() });
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    const orderId = ctx.match[1];
    const result = await deliverOrder(ctx, orderId);
    await ctx.answerCallbackQuery({ text: result });
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    const orderId = ctx.match[1];
    const order = desk.orders.get(orderId);
    if (!order || (order.status !== "awaiting" && order.status !== "checking")) {
      await ctx.answerCallbackQuery({ text: "Already closed" });
      return;
    }
    order.status = "cancelled";
    const pin = desk.pins.find((p) => p.id === order.pinId);
    if (pin) pin.status = "stock";
    await ctx.answerCallbackQuery({ text: "Rejected" });
    await bot.api.sendMessage(order.chatId, `${orderId} was not confirmed. Nothing was sent.`, {
      reply_markup: homeKb(),
    });
    await ctx.editMessageText(`${orderId} rejected.`);
  });

  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await markPaid(ctx, orderId);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = desk.orders.get(orderId);
    if (!order || order.chatId !== ctx.chat.id) {
      await ctx.answerCallbackQuery({ text: "Not found" });
      return;
    }
    if (order.status !== "awaiting" && order.status !== "checking") {
      await ctx.answerCallbackQuery({ text: "Already closed" });
      return;
    }
    order.status = "cancelled";
    const pin = desk.pins.find((p) => p.id === order.pinId);
    if (pin) pin.status = "stock";
    sessionOf(ctx.chat.id).screen = "home";
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.reply(`${orderId} cancelled. Nothing was sent.`, { reply_markup: homeKb() });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    expireStale();

    if (text === "Buy Razer Gold" || text === "Amounts") {
      await sendCatalog(ctx);
      return;
    }
    if (text === "Help") {
      await ctx.reply(
        "Four steps.\n\n1. Pick a Razer Gold US amount.\n2. Pay in USDT on BEP20 (BNB Smart Chain — not TRC20, not ERC20).\n3. Send the exact amount shown — the extra cents are how we match your payment.\n4. Tap I’ve paid. The PIN lands in this chat after the desk confirms.\n\nRedeem at gold.razer.com → Reload → Razer Gold PIN.",
        { reply_markup: homeKb() },
      );
      return;
    }
    if (text === "Orders") {
      const mine = [...desk.orders.values()]
        .filter((o) => o.chatId === ctx.chat.id)
        .slice(-8)
        .reverse();
      const lines =
        mine.length === 0
          ? "No orders yet."
          : mine.map((o) => `${o.id}  ·  $${o.denom}  ·  ${o.status}`).join("\n");
      await ctx.reply(lines, { reply_markup: homeKb() });
      return;
    }
    if (text === "Back" || text === "Menu") {
      await sendHome(ctx, "What do you need?");
      return;
    }
    if (text === "Buy another") {
      await sendCatalog(ctx);
      return;
    }

    const denom = parseDenomLabel(text);
    if (denom) {
      if (stockCount(denom) === 0) {
        await ctx.reply(`$${denom} is out of stock. Pick another amount.`, {
          reply_markup: catalogKb(),
        });
        return;
      }
      const sess = sessionOf(ctx.chat.id);
      sess.screen = "network";
      sess.denom = denom;
      const usdt = PRICES[denom].toFixed(2);
      await ctx.reply(
        `Razer Gold US · $${denom}\nYou pay ${usdt} USDT on BEP20 (plus matching cents).\n\nPrice includes the desk fee. Nothing extra at payment.\n\nBEP20 only — TRC20 or ERC20 will not arrive.`,
        { reply_markup: networkKb() },
      );
      return;
    }

    if (text === "USDT · BEP20" || text === "Bitcoin") {
      const sess = sessionOf(ctx.chat.id);
      const d = sess.denom;
      if (!d) {
        await sendCatalog(ctx);
        return;
      }
      const network = text === "Bitcoin" ? "btc" : "usdt-bep20";
      const address = network === "btc" ? WALLET_BTC : WALLET_BEP20;
      if (!address) {
        await ctx.reply("That wallet is not set on the desk yet. Use USDT · BEP20.");
        return;
      }
      const pin = desk.pins.find((p) => p.status === "stock" && p.denom === d);
      if (!pin) {
        await sendCatalog(ctx, `$${d} is out of stock. Pick another amount.`);
        return;
      }
      const pay = uniqueAmount(PRICES[d], desk.seq, network);
      const order = {
        id: nextOrderId(),
        chatId: ctx.chat.id,
        username: ctx.from?.username || String(ctx.from?.id),
        denom: d,
        network,
        payAmount: pay.amount,
        payAsset: pay.asset,
        address,
        status: /** @type {OrderStatus} */ ("awaiting"),
        pinId: pin.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + ORDER_TTL_MS,
      };
      pin.status = "reserved";
      pin.orderId = order.id;
      desk.orders.set(order.id, order);
      sess.screen = "pay";
      sess.orderId = order.id;

      const payKb = new InlineKeyboard()
        .text("I’ve paid", `paid:${order.id}`)
        .row()
        .text("Cancel", `cancel:${order.id}`);

      await ctx.reply(
        [
          `Send exactly ${pay.amount} ${pay.asset}`,
          `Network: ${pay.asset} · ${network === "btc" ? "BTC" : "BEP20"}`,
          `Order: ${order.id}`,
          "",
          "To:",
          `\`${address}\``,
          "",
          "BEP20 USDT only. TRC20 or ERC20 will not land.",
          "Send the exact amount — matching cents identify this order.",
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: payKb },
      );
      return;
    }

    await ctx.reply("Use the buttons below, or type buy, orders, or help.", {
      reply_markup: homeKb(),
    });
  });

  bot.catch((err) => {
    console.error("bot error", err.error?.description || err.message || err);
  });
}

async function markPaid(ctx, orderId) {
  const order = desk.orders.get(orderId);
  if (!order || order.chatId !== ctx.chat.id) {
    await ctx.reply("Order not found.");
    return;
  }
  if (order.status !== "awaiting") {
    await ctx.reply("This order is already moving.");
    return;
  }
  order.status = "checking";
  const payKb = new InlineKeyboard()
    .text("Confirm + send PIN", `confirm:${order.id}`)
    .row()
    .text("Reject", `reject:${order.id}`);
  await ctx.reply("Payment flagged. The desk will confirm and send your PIN here.");
  await notifyAdmin(
    bot,
    [
      "Payment claimed",
      `${order.id}  ·  $${order.denom}`,
      `${order.payAmount} ${order.payAsset}  ·  ${order.network === "btc" ? "BTC" : "BEP20"}`,
      `@${order.username}`,
      "",
      "Check the wallet, then confirm.",
    ].join("\n"),
    { reply_markup: payKb },
  );
}

async function deliverOrder(ctx, orderId) {
  const order = desk.orders.get(orderId);
  if (!order) return "Not found";
  if (order.status === "delivered") return "Already sent";
  if (order.status !== "checking" && order.status !== "awaiting") return "Closed";
  const pin = desk.pins.find((p) => p.id === order.pinId);
  if (!pin) return "No PIN";
  order.status = "delivered";
  pin.status = "sold";
  await bot.api.sendMessage(
    order.chatId,
    [
      "Payment received. Your PIN is below — keep this message.",
      "",
      `Razer Gold US · $${order.denom}`,
      `PIN: \`${prettyPin(pin.pin)}\``,
      `Serial: \`${pin.serial}\``,
      "",
      "Redeem at gold.razer.com → Reload → Razer Gold PIN.",
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: homeKb() },
  );
  try {
    await ctx.editMessageText(`${orderId} delivered.`);
  } catch {
    /* message may not be editable */
  }
  return "Sent";
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "goldroom-bot",
        bot: Boolean(TOKEN),
        wallet: Boolean(WALLET_BEP20),
        admin: Boolean(ADMIN_ID),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`goldroom health listening on ${PORT}`);
});

if (bot) {
  bot.start({
    onStart: (info) => {
      console.log(`goldroom bot @${info.username} polling`);
      if (!WALLET_BEP20) console.warn("WALLET_USDT_BEP20 is not set");
      if (!ADMIN_ID) console.warn("ADMIN_TELEGRAM_ID is not set — payments cannot be confirmed");
    },
  });
}
