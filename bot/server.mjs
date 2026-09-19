import http from "node:http";
import { Bot, InlineKeyboard, Keyboard, InputFile } from "grammy";
import { createClient } from "@supabase/supabase-js";
import {
  buyRazerPin,
  fazerBalance,
  fazerConfigured,
  matchOffer,
  razerCatalog,
  createPayment,
  getPayment,
  getOrder,
  extractCodes,
} from "./fazer.mjs";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const WALLET_BEP20 = (process.env.WALLET_USDT_BEP20 || "").trim();
const ADMIN_ID = Number((process.env.ADMIN_TELEGRAM_ID || "").trim()) || 0;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ALLOWLIST = (process.env.ALLOWLIST || "")
  .split(/[,\s]+/)
  .map((s) => s.replace(/^@/, "").toLowerCase())
  .filter(Boolean);
const PORT = Number(process.env.PORT || 3000);
const ORDER_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PRICES = { 10: 11.5, 20: 22.8, 25: 28.2, 50: 55.5, 100: 109 };
const DENOMS = [10, 20, 25, 50, 100];
const DEPOSITS = [10, 25, 50, 100, 200];
const PAY_NETWORKS = [
  { code: "bep20", label: "USDT · BEP20", chain: "BEP20" },
  { code: "aptos", label: "USDT · Aptos", chain: "Aptos" },
];

/** @typedef {"awaiting" | "checking" | "credited" | "cancelled"} DepositStatus */
/** @typedef {"pending" | "delivered" | "failed"} PurchaseStatus */

const db =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const desk = {
  seq: 1,
  ready: !db,
  prices: { ...DEFAULT_PRICES },
  /** @type {Map<number, {chatId: number, username: string, balanceCents: number}>} */
  users: new Map(),
  /** @type {Map<string, {id: string, chatId: number, username: string, payAmount: string, payAsset: string, address: string, creditCents: number, status: DepositStatus, createdAt: number, expiresAt: number, creditedAt?: number}>} */
  deposits: new Map(),
  /** @type {Map<string, {id: string, chatId: number, denom: number, retailCents: number, costUsd?: string, fazerOrderId?: string, pin?: string, serial?: string, status: PurchaseStatus, createdAt: number}>} */
  purchases: new Map(),
  /** @type {Map<number, {screen: string, denom?: number, depositId?: string, depositAmount?: string}>} */
  sessions: new Map(),
  adminReplyTo: 0,
};

function nid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function nextId() {
  const id = `GR-${String(1000 + desk.seq)}`;
  desk.seq += 1;
  return id;
}

function exactUsdt(n) {
  const cents = Math.round(Number(n) * 100);
  if (!Number.isFinite(cents) || cents < 1) return null;
  return (cents / 100).toFixed(2);
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

function centsOf(amount) {
  return Math.round(Number(amount) * 100);
}

function retailCents(denom) {
  return Math.round(desk.prices[denom] * 100);
}

function sessionOf(chatId) {
  if (!desk.sessions.has(chatId)) desk.sessions.set(chatId, { screen: "home" });
  return desk.sessions.get(chatId);
}

function ensureUser(chatId, username) {
  if (!desk.users.has(chatId)) {
    desk.users.set(chatId, { chatId, username: username || "", balanceCents: 0 });
  } else if (username) {
    desk.users.get(chatId).username = username;
  }
  return desk.users.get(chatId);
}

function userRow(u) {
  return {
    chat_id: u.chatId,
    username: u.username,
    balance_cents: u.balanceCents,
    updated_at: new Date().toISOString(),
  };
}

function depositRow(d) {
  return {
    id: d.id,
    chat_id: d.chatId,
    username: d.username,
    pay_amount: d.payAmount,
    pay_asset: d.payAsset,
    address: d.address,
    credit_cents: d.creditCents,
    status: d.status,
    created_at: new Date(d.createdAt).toISOString(),
    expires_at: new Date(d.expiresAt).toISOString(),
    credited_at: d.creditedAt ? new Date(d.creditedAt).toISOString() : null,
  };
}

function purchaseRow(p) {
  return {
    id: p.id,
    chat_id: p.chatId,
    denom: p.denom,
    retail_cents: p.retailCents,
    cost_usd: p.costUsd || null,
    fazer_order_id: p.fazerOrderId || null,
    pin: p.pin || null,
    serial: p.serial || null,
    status: p.status,
    created_at: new Date(p.createdAt).toISOString(),
  };
}

async function save({ users = [], deposits = [], purchases = [] } = {}) {
  if (!db) return;
  try {
    if (users.length) {
      const { error } = await db.from("goldroom_users").upsert(users.map(userRow));
      if (error) throw error;
    }
    if (deposits.length) {
      const { error } = await db.from("goldroom_deposits").upsert(deposits.map(depositRow));
      if (error) throw error;
    }
    if (purchases.length) {
      const { error } = await db.from("goldroom_purchases").upsert(purchases.map(purchaseRow));
      if (error) throw error;
    }
    const { error } = await db.from("goldroom_meta").upsert({ key: "seq", value: desk.seq });
    if (error) throw error;
  } catch (err) {
    console.error("supabase save failed", err.message || err);
  }
}

async function savePrices() {
  if (!db) return;
  try {
    const rows = DENOMS.map((d) => ({ key: `price_${d}`, value: retailCents(d) }));
    const { error } = await db.from("goldroom_meta").upsert(rows);
    if (error) throw error;
  } catch (err) {
    console.error("supabase save prices failed", err.message || err);
  }
}

function priceBoard() {
  return DENOMS.map((d) => `$${d}  ·  ${desk.prices[d].toFixed(2)} USDT`).join("\n");
}

async function loadDesk() {
  if (!db) {
    console.warn("Supabase missing — memory only");
    return false;
  }
  try {
    const [users, deposits, purchases, meta] = await Promise.all([
      db.from("goldroom_users").select("*"),
      db.from("goldroom_deposits").select("*"),
      db.from("goldroom_purchases").select("*"),
      db.from("goldroom_meta").select("*"),
    ]);
    if (users.error) throw users.error;
    if (deposits.error) throw deposits.error;
    if (purchases.error) throw purchases.error;
    if (meta.error) throw meta.error;
    desk.users = new Map(
      (users.data || []).map((r) => [
        Number(r.chat_id),
        {
          chatId: Number(r.chat_id),
          username: r.username || "",
          balanceCents: Number(r.balance_cents) || 0,
        },
      ]),
    );
    desk.deposits = new Map(
      (deposits.data || []).map((r) => [
        r.id,
        {
          id: r.id,
          chatId: Number(r.chat_id),
          username: r.username || "",
          payAmount: r.pay_amount,
          payAsset: r.pay_asset,
          address: r.address,
          creditCents: Number(r.credit_cents) || 0,
          status: r.status,
          createdAt: new Date(r.created_at).getTime(),
          expiresAt: new Date(r.expires_at).getTime(),
          creditedAt: r.credited_at ? new Date(r.credited_at).getTime() : undefined,
        },
      ]),
    );
    desk.purchases = new Map(
      (purchases.data || []).map((r) => [
        r.id,
        {
          id: r.id,
          chatId: Number(r.chat_id),
          denom: r.denom,
          retailCents: r.retail_cents,
          costUsd: r.cost_usd || undefined,
          fazerOrderId: r.fazer_order_id || undefined,
          pin: r.pin || undefined,
          serial: r.serial || undefined,
          status: r.status,
          createdAt: new Date(r.created_at).getTime(),
        },
      ]),
    );
    desk.seq = 1;
    desk.prices = { ...DEFAULT_PRICES };
    for (const r of meta.data || []) {
      if (r.key === "seq") desk.seq = Number(r.value) || 1;
      if (String(r.key).startsWith("price_")) {
        const d = Number(String(r.key).slice(6));
        if (DENOMS.includes(d) && Number(r.value) > 0) desk.prices[d] = Number(r.value) / 100;
      }
    }
    desk.ready = true;
    console.log(
      `supabase loaded ${desk.users.size} users, ${desk.deposits.size} deposits, ${desk.purchases.size} purchases`,
    );
    return true;
  } catch (err) {
    console.error("supabase load failed — run bot/schema-v2.sql:", err.message || err);
    return false;
  }
}

function homeKb() {
  return new Keyboard()
    .text("Deposit")
    .text("Buy Razer Gold")
    .row()
    .text("Balance")
    .text("Orders")
    .row()
    .text("Support")
    .text("Help")
    .resized();
}

function supportKb() {
  return new Keyboard()
    .text("Deposit help")
    .text("Buy a card")
    .row()
    .text("Redeem PIN")
    .text("My order")
    .row()
    .text("Talk to a person")
    .row()
    .text("Back")
    .resized();
}

function supportSnapshot(chatId) {
  const user = desk.users.get(chatId);
  const deps = [...desk.deposits.values()].filter((d) => d.chatId === chatId).slice(-3).reverse();
  const buys = [...desk.purchases.values()].filter((p) => p.chatId === chatId).slice(-3).reverse();
  const pending = pendingBuy(chatId);
  const waiting = [...desk.deposits.values()].find(
    (d) => d.chatId === chatId && (d.status === "awaiting" || d.status === "checking"),
  );
  return { user, deps, buys, pending, waiting };
}

function supportFaq(text, chatId) {
  const t = String(text || "").toLowerCase();
  if (/talk to a person|human|agent|specialist|complaint|manager|staff|real person/.test(t)) return null;
  if (/(deposit|payment|usdt).*(not|no|never|didn't|didnt|still|waiting|delay|pending|arriv|missing|reflect)/.test(t)) return null;
  if (/(paid|sent).*(not|no|still|waiting)/.test(t)) return null;
  if (/refund|scam|stolen|wrong pin|invalid pin|didn't get|didnt get|no pin|no code/.test(t)) return null;
  if (t === "my order" || /where.*order|order status|my (pin|card|code)/.test(t)) {
    const snap = supportSnapshot(chatId);
    if (snap.pending) {
      return "Your card is still being issued. Stay in this chat — the PIN will arrive here. Do not place another order.";
    }
    const last = snap.buys[0];
    if (last && last.status === "delivered") {
      return `Your latest card is $${last.denom} (${last.id}). Check this chat for the PIN and the downloadable file. Redeem at gold.razer.com → Reload → Razer Gold PIN.`;
    }
    if (snap.waiting) {
      return `We see deposit ${snap.waiting.id} for ${snap.waiting.payAmount} USDT. It credits automatically after confirmation. If this is taking longer than usual, a specialist will review it.`;
    }
    return "We don't see an open order. Use Deposit to add funds, then Buy Razer Gold.";
  }
  if (t === "deposit help" || /how.*deposit|deposit.*work|send.*usdt|which network|bep20|aptos/.test(t)) {
    return "How to deposit\n\n1. Tap Deposit and enter an amount.\n2. Choose BEP20 or Aptos.\n3. Send the exact USDT amount shown. Network fees are paid from your wallet.\n4. Your Goldroom balance updates after confirmation.\n\nUse only the network printed on that deposit.";
  }
  if (t === "buy a card" || /how.*buy|buy.*card|purchase|price/.test(t)) {
    return "How to buy\n\n1. Deposit USDT so you have a Goldroom balance.\n2. Tap Buy Razer Gold and choose an amount you can afford.\n3. Confirm. Your PIN arrives in this chat and as a .txt file.\n\nDo not buy again while an order is processing.";
  }
  if (t === "redeem pin" || /redeem|razer\.com|how.*use|where.*use/.test(t)) {
    return "Redeem at gold.razer.com → Reload → Razer Gold PIN.\nEnter the code exactly as sent. Codes are final once revealed.";
  }
  if (/txt|file|download/.test(t)) {
    return "Each PIN is sent as a chat message and a .txt file. The code in both should match. The file name includes your order id so later cards don't overwrite earlier ones.";
  }
  if (/balance/.test(t)) {
    const user = desk.users.get(chatId);
    return `Your Goldroom balance is ${money(user?.balanceCents || 0)} USDT.`;
  }
  if (/how long|confirm|how (fast|soon)|when.*credit/.test(t)) {
    return "Most deposits credit automatically after the network confirms. Time varies by network. If a deposit is taking longer than usual, a specialist will review it.";
  }
  if (/minimum|min deposit/.test(t)) {
    return "Type the amount you want, then pick a network. If the amount is below that network's minimum, we'll tell you the minimum before you send.";
  }
  return undefined;
}

async function escalateSupport(ctx, text) {
  const chatId = ctx.chat.id;
  const user = ensureUser(chatId, ctx.from?.username || String(ctx.from?.id));
  const snap = supportSnapshot(chatId);
  const kb = new InlineKeyboard()
    .text("Reply", `supreply:${chatId}`)
    .text("Close", `supclose:${chatId}`);
  await notifyAdmin(
    [
      "Support ticket",
      `@${user.username || "—"}  ·  id ${chatId}`,
      `Balance ${money(user.balanceCents)} USDT`,
      snap.waiting ? `Open deposit ${snap.waiting.id}  ·  ${snap.waiting.payAmount}  ·  ${snap.waiting.status}` : "No open deposit",
      snap.pending ? `Open card $${snap.pending.denom}  ·  ${snap.pending.id}` : "No open card",
      "",
      text,
    ].join("\n"),
    { reply_markup: kb },
  );
  await ctx.reply(
    "A Goldroom specialist will be assigned to you shortly. Keep this chat open — we'll reply here.",
    { reply_markup: supportKb() },
  );
}

async function openSupport(ctx) {
  sessionOf(ctx.chat.id).screen = "support";
  await ctx.reply(
    "Goldroom Support\n\nAsk a question, or pick a topic. For anything we can't settle here, a specialist is assigned to you.",
    { reply_markup: supportKb() },
  );
}

async function handleSupportText(ctx, text) {
  const faq = supportFaq(text, ctx.chat.id);
  if (faq) {
    await ctx.reply(faq, { reply_markup: supportKb() });
    return;
  }
  await escalateSupport(ctx, text);
}

function depositKb() {
  const kb = new Keyboard();
  DEPOSITS.forEach((n, i) => {
    kb.text(`${n} USDT`);
    if (i % 2 === 1) kb.row();
  });
  if (DEPOSITS.length % 2 === 1) kb.row();
  kb.text("Back");
  return kb.resized();
}

function networkKb() {
  return new Keyboard()
    .text("USDT · BEP20")
    .row()
    .text("USDT · Aptos")
    .row()
    .text("Back")
    .resized();
}

function networkMeta(code) {
  return PAY_NETWORKS.find((n) => n.code === code) || PAY_NETWORKS[0];
}

function parseNetwork(text) {
  const t = String(text || "").trim().toLowerCase().replace(/·/g, " ").replace(/\s+/g, " ");
  if (t === "usdt bep20" || t === "bep20") return "bep20";
  if (t === "usdt aptos" || t === "aptos") return "aptos";
  return null;
}

async function askNetwork(ctx, amount) {
  const sess = sessionOf(ctx.chat.id);
  sess.screen = "network";
  sess.depositAmount = amount;
  await ctx.reply(
    `${amount} USDT\n\nChoose a network.`,
    { reply_markup: networkKb() },
  );
}

function catalogKb(balanceCents) {
  const kb = new Keyboard();
  for (const d of DENOMS) {
    const need = retailCents(d);
    kb.text(balanceCents >= need ? `$${d} · ${money(need)} USDT` : `$${d} · need ${money(need)}`).row();
  }
  kb.text("Deposit").row().text("Back");
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

async function expireStale() {
  const now = Date.now();
  const dirty = [];
  for (const d of desk.deposits.values()) {
    if (d.status === "awaiting" && d.expiresAt < now) {
      d.status = "cancelled";
      dirty.push(d);
    }
  }
  if (dirty.length) await save({ deposits: dirty });
}

function prettyPin(pin) {
  return String(pin).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function pinFileName(denom, orderId) {
  const id = String(orderId || "").replace(/[^\w-]+/g, "").slice(0, 24) || Date.now().toString(36);
  return `Goldroom-USD${denom}-${id}.txt`;
}

function pinFile(denom, orderId, pin, serial) {
  const lines = [
    "Goldroom",
    `Razer Gold US · $${denom}`,
    `Order ${orderId}`,
    "",
    "PIN",
    String(pin).trim(),
    "",
  ];
  if (serial) {
    lines.push("Serial", String(serial).trim(), "");
  }
  lines.push("Redeem at gold.razer.com", "Reload → Razer Gold PIN", "");
  return Buffer.from(lines.join("\n"), "utf8");
}

async function sendHome(ctx, text) {
  sessionOf(ctx.chat.id).screen = "home";
  await ctx.reply(text, { reply_markup: homeKb() });
}

async function notifyAdmin(text, extra = {}) {
  if (!ADMIN_ID || !bot) return;
  try {
    await bot.api.sendMessage(ADMIN_ID, text, extra);
  } catch (err) {
    console.error("admin notify failed", err instanceof Error ? err.message : err);
  }
}

function parseDenomLabel(text) {
  const m = text.match(/^\$(\d+)/);
  if (!m) return null;
  const d = Number(m[1]);
  return DENOMS.includes(d) ? d : null;
}

function parseDepositLabel(text) {
  const m = text.match(/^(\d+(?:\.\d{1,2})?)\s*USDT$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

const watching = new Set();

function paidStatus(st) {
  return ["completed", "complete", "success", "paid", "confirmed"].includes(String(st || "").toLowerCase());
}

async function tryConfirmFromFazer(depositId) {
  const d = desk.deposits.get(depositId);
  if (!d) return "Not found";
  if (d.status === "credited") return "Already credited";
  if (d.status === "cancelled") return "Closed";
  if (!fazerConfigured()) return d.status;
  try {
    const pay = await getPayment(d.id);
    if (!pay) return d.status;
    if (paidStatus(pay.status)) {
      const credited = exactUsdt(pay.creditAmount) || d.payAmount;
      if (credited) d.creditCents = centsOf(credited);
      d.status = "checking";
      return creditDeposit(depositId);
    }
    if (["cancelled", "canceled", "expired", "failed"].includes(pay.status)) {
      d.status = "cancelled";
      await save({ deposits: [d] });
      return "cancelled";
    }
  } catch (err) {
    console.error("payment poll failed", err instanceof Error ? err.message : err);
  }
  return d.status;
}

async function watchPayment(depositId) {
  if (watching.has(depositId)) return;
  watching.add(depositId);
  try {
    const first = desk.deposits.get(depositId);
    const until = (first?.expiresAt || Date.now()) + 10 * 60 * 1000;
    while (Date.now() < until) {
      const st = await tryConfirmFromFazer(depositId);
      if (["Credited", "Already credited", "Closed", "cancelled", "Not found"].includes(st)) return;
      await new Promise((r) => setTimeout(r, 8000));
    }
  } finally {
    watching.delete(depositId);
  }
}

async function startDeposit(ctx, baseUsdt, method = "bep20") {
  const amount = exactUsdt(baseUsdt);
  if (!amount) {
    await ctx.reply("Enter an amount in USDT, for example 24.8 or 10.");
    return;
  }
  if (!fazerConfigured()) {
    await ctx.reply("Deposits are paused for a moment. Please try again shortly.");
    return;
  }
  const user = ensureUser(ctx.chat.id, ctx.from?.username || String(ctx.from?.id));
  await ctx.reply("Creating your deposit address…");
  let pay;
  try {
    pay = await createPayment(amount, `dep-${ctx.chat.id}-${Date.now()}`, method);
  } catch (err) {
    if (err && err.code === "MIN") {
      await ctx.reply(`Minimum deposit is ${Number(err.min).toFixed(2)} USDT.`);
      return;
    }
    if (err && err.code === "MAX") {
      await ctx.reply(`Maximum deposit is ${Number(err.max).toFixed(2)} USDT.`);
      return;
    }
    console.error("create payment failed", err instanceof Error ? err.message : err);
    await ctx.reply("Could not create a deposit right now. Please try again in a minute.");
    await notifyAdmin(`Deposit create failed for @${user.username}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const send = exactUsdt(pay.sendAmount) || amount;
  const credit = exactUsdt(pay.creditAmount) || amount;
  const exp = pay.expiresAt ? new Date(pay.expiresAt).getTime() : Date.now() + ORDER_TTL_MS;
  const deposit = {
    id: pay.id,
    chatId: ctx.chat.id,
    username: user.username,
    payAmount: send,
    payAsset: "USDT",
    address: pay.address,
    creditCents: centsOf(credit),
    status: /** @type {DepositStatus} */ ("awaiting"),
    createdAt: Date.now(),
    expiresAt: Number.isFinite(exp) ? exp : Date.now() + ORDER_TTL_MS,
  };
  desk.deposits.set(deposit.id, deposit);
  sessionOf(ctx.chat.id).screen = "pay";
  sessionOf(ctx.chat.id).depositId = deposit.id;
  await save({ deposits: [deposit] });
  const kb = new InlineKeyboard()
    .text("I’ve paid", `paid:${deposit.id}`)
    .row()
    .text("Cancel", `cancel:${deposit.id}`);
  const lines = [
    `Send exactly ${send} USDT`,
    `Network: ${networkMeta(method).label}`,
    `Deposit: ${deposit.id}`,
    "",
    "To:",
    `\`${pay.address}\``,
  ];
  if (pay.memo) {
    lines.push("", `Memo: \`${pay.memo}\``);
  }
  lines.push("", "Send this amount. Network fees on your wallet are paid by you.", "Your balance updates automatically after confirmation.");
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", reply_markup: kb });
  void watchPayment(deposit.id);
}

async function creditDeposit(depositId) {
  const d = desk.deposits.get(depositId);
  if (!d) return "Not found";
  if (d.status === "credited") return "Already credited";
  if (d.status !== "awaiting" && d.status !== "checking") return "Closed";
  const user = ensureUser(d.chatId, d.username);
  user.balanceCents += d.creditCents;
  d.status = "credited";
  d.creditedAt = Date.now();
  await save({ users: [user], deposits: [d] });
  if (bot) {
    await bot.api.sendMessage(
      d.chatId,
      `Deposit ${d.id} confirmed.\nBalance: ${money(user.balanceCents)} USDT\n\nYou can buy Razer Gold US now.`,
      { reply_markup: homeKb() },
    );
  }
  return "Credited";
}

async function offerCard(ctx, denom) {
  const user = ensureUser(ctx.chat.id, ctx.from?.username || String(ctx.from?.id));
  const need = retailCents(denom);
  if (pendingBuy(ctx.chat.id)) {
    await ctx.reply(
      "Your last order is still processing. The PIN will be sent here. Please wait — do not buy again.",
      { reply_markup: homeKb() },
    );
    return;
  }
  sessionOf(ctx.chat.id).screen = "confirm";
  sessionOf(ctx.chat.id).denom = denom;
  const kb = new InlineKeyboard()
    .text(`Pay ${money(need)} USDT`, `buy:${denom}`)
    .row()
    .text("Cancel", "buyx");
  await ctx.reply(
    `Razer Gold US · $${denom}\n${money(need)} USDT\nBalance: ${money(user.balanceCents)} USDT`,
    { reply_markup: kb },
  );
}

const buying = new Set();
const watchingBuys = new Set();

function pendingBuy(chatId) {
  return [...desk.purchases.values()].find(
    (p) => p.chatId === chatId && p.status === "pending",
  );
}

async function sendPinMessages(chatId, purchase, pin, serial) {
  const code = String(pin || "").trim();
  const serialCode = serial ? String(serial).trim() : "";
  const orderId = String(purchase.id);
  const denom = purchase.denom;
  const user = ensureUser(chatId, "");
  const body = [
    "Your PIN is below — keep this message.",
    "",
    `Razer Gold US · $${denom}`,
    `PIN: \`${prettyPin(code)}\``,
    serialCode ? `Serial: \`${serialCode}\`` : "",
    "",
    `Spent ${money(purchase.retailCents)} USDT. Balance: ${money(user.balanceCents)} USDT`,
    "",
    "Redeem at gold.razer.com → Reload → Razer Gold PIN.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  if (!bot) return;
  await bot.api.sendMessage(chatId, body, { parse_mode: "Markdown", reply_markup: homeKb() });
  try {
    await bot.api.sendDocument(
      chatId,
      new InputFile(pinFile(denom, orderId, code, serialCode), pinFileName(denom, orderId)),
      { caption: "Download and keep this file. Screenshot the message above if you want a picture." },
    );
  } catch (fileErr) {
    console.error("pin file send failed", fileErr instanceof Error ? fileErr.message : fileErr);
  }
}

async function finishPurchase(purchase, pin, serial, costUsd, orderId) {
  purchase.status = "delivered";
  purchase.pin = pin;
  purchase.serial = serial;
  purchase.fazerOrderId = orderId || purchase.fazerOrderId;
  purchase.costUsd = costUsd || purchase.costUsd;
  await save({ purchases: [purchase] });
  await sendPinMessages(purchase.chatId, purchase, pin, serial);
  const user = desk.users.get(purchase.chatId);
  await notifyAdmin(
    `Sold $${purchase.denom} to @${user?.username || purchase.chatId}\n${purchase.id}\nFazer ${purchase.fazerOrderId || ""} · cost ${purchase.costUsd || "?"} USD`,
  );
}

async function refundPurchase(purchase, reason) {
  if (purchase.status === "failed" || purchase.status === "delivered") return;
  const user = ensureUser(purchase.chatId, "");
  user.balanceCents += purchase.retailCents;
  purchase.status = "failed";
  await save({ users: [user], purchases: [purchase] });
  if (bot) {
    await bot.api.sendMessage(
      purchase.chatId,
      `This card is temporarily unavailable. Your ${money(purchase.retailCents)} USDT is back on your balance (${money(user.balanceCents)}).`,
      { reply_markup: homeKb() },
    );
  }
  await notifyAdmin(`Buy refunded ${purchase.id} @${user.username} $${purchase.denom}\n${reason}`);
}

async function watchPurchase(purchaseId) {
  if (watchingBuys.has(purchaseId)) return;
  watchingBuys.add(purchaseId);
  try {
    const until = Date.now() + 12 * 60 * 1000;
    while (Date.now() < until) {
      const purchase = desk.purchases.get(purchaseId);
      if (!purchase || purchase.status !== "pending") return;
      if (!purchase.fazerOrderId) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      try {
        const order = await getOrder(purchase.fazerOrderId);
        const codes = extractCodes(order);
        const st = String(order?.status || "").toLowerCase();
        if (codes.length) {
          const serial =
            order.serial ||
            order.payload?.serial ||
            (typeof order.cards?.[0] === "object" ? order.cards[0].serial : "") ||
            purchase.fazerOrderId;
          await finishPurchase(purchase, codes[0], serial, purchase.costUsd, purchase.fazerOrderId);
          return;
        }
        if (["failed", "fail", "refund", "refunded", "cancelled", "canceled", "error"].includes(st)) {
          await refundPurchase(purchase, `supplier ${st}`);
          return;
        }
      } catch (err) {
        console.error("watch purchase", err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    const stuck = desk.purchases.get(purchaseId);
    if (stuck && stuck.status === "pending") {
      await notifyAdmin(
        `PIN still processing ${stuck.id} $${stuck.denom} chat ${stuck.chatId}\nFazer ${stuck.fazerOrderId || "?"}\nDo not refund unless Fazer failed.`,
      );
      if (bot) {
        await bot.api.sendMessage(
          stuck.chatId,
          "Your order is still being issued. Keep this chat open — the PIN will arrive here. Do not pay again.",
          { reply_markup: homeKb() },
        );
      }
    }
  } finally {
    watchingBuys.delete(purchaseId);
  }
}

async function buyCard(ctx, denom) {
  const chatId = ctx.chat.id;
  const user = ensureUser(chatId, ctx.from?.username || String(ctx.from?.id));
  const need = retailCents(denom);

  const open = pendingBuy(chatId);
  if (open) {
    await ctx.reply(
      "Your last order is still processing. The PIN will be sent here. Please wait — do not buy again.",
      { reply_markup: homeKb() },
    );
    void watchPurchase(open.id);
    return;
  }
  if (buying.has(chatId)) {
    await ctx.reply("Please wait, your order is already being placed.");
    return;
  }
  if (user.balanceCents < need) {
    await ctx.reply(
      `$${denom} is ${money(need)} USDT. Your balance is ${money(user.balanceCents)} USDT.\nDeposit to continue.`,
      { reply_markup: depositKb() },
    );
    sessionOf(chatId).screen = "deposit";
    return;
  }
  if (!fazerConfigured()) {
    await ctx.reply("Purchases are paused for a moment. Please try again shortly.");
    return;
  }
  try {
    const cat = await razerCatalog();
    if (!matchOffer(cat.offers, denom)) {
      const fresh = await razerCatalog(true);
      if (!matchOffer(fresh.offers, denom)) {
        await ctx.reply("This amount is not available right now. Try another amount.", {
          reply_markup: catalogKb(user.balanceCents),
        });
        return;
      }
    }
  } catch (err) {
    console.error("catalog precheck", err instanceof Error ? err.message : err);
    await ctx.reply("Purchases are paused for a moment. Please try again shortly.");
    return;
  }

  buying.add(chatId);
  user.balanceCents -= need;
  const purchase = {
    id: nextId(),
    chatId,
    denom,
    retailCents: need,
    status: /** @type {PurchaseStatus} */ ("pending"),
    createdAt: Date.now(),
  };
  desk.purchases.set(purchase.id, purchase);
  await save({ users: [user], purchases: [purchase] });
  await ctx.reply(`Issuing Razer Gold US · $${denom}…`);
  try {
    const card = await buyRazerPin(denom, purchase.id);
    purchase.fazerOrderId = card.orderId;
    await finishPurchase(purchase, card.pin, card.serial, card.costUsd, card.orderId);
  } catch (err) {
    const code = err && err.code;
    const orderId = err && err.orderId;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fazer buy failed", msg);
    if (orderId) purchase.fazerOrderId = orderId;
    if (code === "PROCESSING" || err?.charged) {
      await save({ purchases: [purchase] });
      await ctx.reply(
        "Your order is confirmed and being issued. The PIN will arrive in this chat. Do not buy again.",
        { reply_markup: homeKb() },
      );
      await notifyAdmin(`Processing ${purchase.id} @${user.username} $${denom}\nFazer ${orderId || ""}`);
      void watchPurchase(purchase.id);
    } else if (code === "FAILED") {
      await refundPurchase(purchase, msg);
    } else if (code === "NO_OFFER") {
      await refundPurchase(purchase, msg);
    } else if (orderId || purchase.fazerOrderId) {
      await save({ purchases: [purchase] });
      await ctx.reply(
        "Your order is being issued. The PIN will arrive in this chat. Do not buy again.",
        { reply_markup: homeKb() },
      );
      void watchPurchase(purchase.id);
    } else {
      await refundPurchase(purchase, msg);
    }
  } finally {
    buying.delete(chatId);
  }
}

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Health will run; bot will not.");
}

const bot = TOKEN ? new Bot(TOKEN) : null;

if (bot) {
  bot.use(async (ctx, next) => {
    if (ctx.from && !allowed(ctx) && !isAdmin(ctx)) {
      await ctx.reply("Goldroom is available to registered customers only.");
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    ensureUser(ctx.chat.id, ctx.from?.username || String(ctx.from?.id));
    await sendHome(
      ctx,
      "Goldroom\nOfficial Razer Gold US gift cards.\n\nPay with USDT on BEP20 or Aptos. Your code is delivered in this chat.\n\nDeposit to add funds, then buy.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Buy Razer Gold US in three steps.\n\n1. Deposit USDT on BEP20 or Aptos — send the exact amount shown.\n2. When your balance updates, tap Buy Razer Gold.\n3. Your PIN arrives in this chat.\n\nRedeem at gold.razer.com → Reload → Razer Gold PIN.\nCodes are final once revealed.\n\nNeed help? Tap Support.",
      { reply_markup: homeKb() },
    );
  });

  bot.command("done", async (ctx) => {
    if (!isAdmin(ctx)) return;
    desk.adminReplyTo = 0;
    await ctx.reply("Reply mode off.");
  });

  bot.command("reply", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const parts = (ctx.match || "").trim().split(/\s+/);
    const chatId = Number(parts[0]);
    const msg = parts.slice(1).join(" ");
    if (!chatId) {
      await ctx.reply("Usage: /reply 123456789 your message");
      return;
    }
    if (!msg) {
      desk.adminReplyTo = chatId;
      await ctx.reply(`Next messages go to ${chatId}. /done to stop.`);
      return;
    }
    try {
      await bot.api.sendMessage(chatId, msg, { reply_markup: supportKb() });
      await ctx.reply("Sent.");
    } catch (err) {
      await ctx.reply(`Could not send: ${err instanceof Error ? err.message : err}`);
    }
  });

  bot.command("balance", async (ctx) => {
    const user = ensureUser(ctx.chat.id, ctx.from?.username || String(ctx.from?.id));
    let extra = "";
    if (isAdmin(ctx) && fazerConfigured()) {
      try {
        const f = await fazerBalance();
        extra = `\n\nFazer supplier: ${f.balance} ${f.currency}`;
      } catch (err) {
        extra = `\n\nFazer: ${err.message || err}`;
      }
    }
    await ctx.reply(`Goldroom balance: ${money(user.balanceCents)} USDT${extra}`, {
      reply_markup: homeKb(),
    });
  });

  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const pending = [...desk.deposits.values()].filter(
      (d) => d.status === "awaiting" || d.status === "checking",
    ).length;
    const cards = [...desk.purchases.values()].filter((p) => p.status === "delivered").length;
    let supplier = "not set";
    if (fazerConfigured()) {
      try {
        const f = await fazerBalance();
        supplier = `${f.balance} ${f.currency}`;
      } catch (err) {
        supplier = err.message || String(err);
      }
    }
    await ctx.reply(
      [
        "Goldroom admin",
        "",
        `Customers: ${desk.users.size}`,
        `Pending deposits: ${pending}`,
        `Cards issued: ${cards}`,
        `Supplier balance: ${supplier}`,
        "",
        "Prices",
        priceBoard(),
        "",
        "/prices — list",
        "/price 25 29.50 — set sell price",
        "/users — customer balances",
        "/credit 123456789 25 — add USDT",
        "/catalog — supplier offers",
      ].join("\n"),
    );
  });

  bot.command("prices", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    await ctx.reply(`Sell prices (USDT)\n${priceBoard()}\n\nChange with:\n/price 25 29.50`);
  });

  bot.command("price", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const raw = (ctx.match || "").replace(/[$,=]/g, " ").replace(/usdt/gi, " ");
    const parts = raw.trim().split(/\s+/);
    const denom = Number(parts[0]);
    const usdt = Number(parts[1]);
    if (!DENOMS.includes(denom) || !Number.isFinite(usdt) || usdt <= 0) {
      await ctx.reply(`Usage: /price 25 29.50\nAmounts: ${DENOMS.map((d) => "$" + d).join(", ")}`);
      return;
    }
    desk.prices[denom] = Math.round(usdt * 100) / 100;
    await savePrices();
    const user = ensureUser(ctx.chat.id, ctx.from?.username || "");
    await ctx.reply(
      `$${denom} now sells for ${desk.prices[denom].toFixed(2)} USDT.\nThis is what buyers pay.\n\n${priceBoard()}`,
      { reply_markup: catalogKb(user.balanceCents) },
    );
  });

  bot.command("users", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const list = [...desk.users.values()].sort((a, b) => b.balanceCents - a.balanceCents);
    if (!list.length) {
      await ctx.reply("No customers yet.");
      return;
    }
    const lines = list
      .slice(0, 20)
      .map((u) => `${u.chatId}  ·  @${u.username || "—"}  ·  ${money(u.balanceCents)} USDT`)
      .join("\n");
    await ctx.reply(`Customers\n${lines}`);
  });

  bot.command("catalog", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    try {
      const cat = await razerCatalog();
      if (!cat.categoryId) {
        const names = cat.hits.map((h) => `${h.category_id}  ·  ${h.name}`).join("\n") || "none";
        await ctx.reply(`No Razer category matched.\nHits:\n${names}\n\nSet FAZER_CATEGORY_ID.`);
        return;
      }
      const lines = DENOMS.map((d) => {
        const o = matchOffer(cat.offers, d);
        return o
          ? `$${d}  ·  ${o.card_id}  ·  ${o.price_usd || o.price} USD`
          : `$${d}  ·  no offer`;
      }).join("\n");
      await ctx.reply(`Fazer category: ${cat.categoryId}\n${lines}`);
    } catch (err) {
      await ctx.reply(`Fazer catalog failed: ${err.message || err}`);
    }
  });

  bot.command("credit", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Not for buyers.");
      return;
    }
    const parts = (ctx.match || "").trim().split(/\s+/);
    const who = parts[0];
    const amount = Number(parts[1]);
    if (!who || !Number.isFinite(amount) || amount <= 0) {
      await ctx.reply("Usage: /credit 123456789 25.00\nNumeric Telegram id, then USDT.");
      return;
    }
    const chatId = Number(who.replace(/^@/, ""));
    if (!chatId) {
      await ctx.reply("Use the numeric Telegram id from the deposit message.");
      return;
    }
    const user = ensureUser(chatId, who);
    user.balanceCents += centsOf(amount.toFixed(2));
    await save({ users: [user] });
    await ctx.reply(`Credited ${amount.toFixed(2)} USDT. Balance ${money(user.balanceCents)}.`);
    try {
      await bot.api.sendMessage(
        chatId,
        `Your account has been credited ${amount.toFixed(2)} USDT. Balance: ${money(user.balanceCents)} USDT.`,
        { reply_markup: homeKb() },
      );
    } catch {
      /* user may not have started */
    }
  });

  bot.command("orders", async (ctx) => {
    const mineDep = [...desk.deposits.values()]
      .filter((d) => (isAdmin(ctx) ? true : d.chatId === ctx.chat.id))
      .slice(-6)
      .reverse();
    const mineBuy = [...desk.purchases.values()]
      .filter((p) => (isAdmin(ctx) ? true : p.chatId === ctx.chat.id))
      .slice(-6)
      .reverse();
    const lines = [
      mineDep.length ? "Deposits" : "No deposits.",
      ...mineDep.map((d) => `${d.id}  ·  ${d.payAmount} ${d.payAsset}  ·  ${d.status}`),
      "",
      mineBuy.length ? "Cards" : "No cards yet.",
      ...mineBuy.map((p) => `${p.id}  ·  $${p.denom}  ·  ${p.status}`),
    ].join("\n");
    await ctx.reply(lines, { reply_markup: homeKb() });
  });

  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    const denom = Number(ctx.match[1]);
    if (!DENOMS.includes(denom)) {
      await ctx.answerCallbackQuery({ text: "Unknown amount" });
      return;
    }
    await ctx.answerCallbackQuery();
    await buyCard(ctx, denom);
  });

  bot.callbackQuery("buyx", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    const user = ensureUser(ctx.chat.id, ctx.from?.username || "");
    await ctx.reply("Choose an amount.", { reply_markup: catalogKb(user.balanceCents) });
  });

  bot.callbackQuery(/^supreply:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    desk.adminReplyTo = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "Reply mode" });
    await ctx.reply(`Next messages go to ${desk.adminReplyTo}. Send /done when finished.`);
  });

  bot.callbackQuery(/^supclose:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    const chatId = Number(ctx.match[1]);
    if (desk.adminReplyTo === chatId) desk.adminReplyTo = 0;
    await ctx.answerCallbackQuery({ text: "Closed" });
    try {
      await bot.api.sendMessage(
        chatId,
        "Your support ticket is closed. Tap Support anytime if you need us again.",
        { reply_markup: homeKb() },
      );
    } catch {
      /* ignore */
    }
    await ctx.reply(`Closed ${chatId}.`);
  });

  bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const d = desk.deposits.get(id);
    if (!d || d.chatId !== ctx.chat.id) {
      await ctx.answerCallbackQuery({ text: "Not found" });
      return;
    }
    if (d.status === "credited") {
      await ctx.answerCallbackQuery({ text: "Already credited" });
      return;
    }
    if (d.status === "cancelled") {
      await ctx.answerCallbackQuery({ text: "Closed" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Checking…" });
    const st = await tryConfirmFromFazer(id);
    if (st === "Credited" || st === "Already credited") {
      return;
    }
    d.status = "checking";
    await save({ deposits: [d] });
    await ctx.reply("We're confirming it now. Your balance will update automatically.");
    void watchPayment(id);
  });

  bot.callbackQuery(/^credit:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    const result = await creditDeposit(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: result });
    try {
      await ctx.editMessageText(`${ctx.match[1]} ${result.toLowerCase()}.`);
    } catch {
      /* ignore */
    }
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Desk only" });
      return;
    }
    const d = desk.deposits.get(ctx.match[1]);
    if (!d || (d.status !== "awaiting" && d.status !== "checking")) {
      await ctx.answerCallbackQuery({ text: "Already closed" });
      return;
    }
    d.status = "cancelled";
    await save({ deposits: [d] });
    await ctx.answerCallbackQuery({ text: "Rejected" });
    await bot.api.sendMessage(d.chatId, `${d.id} was not credited. Nothing added.`, {
      reply_markup: homeKb(),
    });
    try {
      await ctx.editMessageText(`${d.id} rejected.`);
    } catch {
      /* ignore */
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const d = desk.deposits.get(ctx.match[1]);
    if (!d || d.chatId !== ctx.chat.id) {
      await ctx.answerCallbackQuery({ text: "Not found" });
      return;
    }
    if (d.status !== "awaiting" && d.status !== "checking") {
      await ctx.answerCallbackQuery({ text: "Already closed" });
      return;
    }
    d.status = "cancelled";
    sessionOf(ctx.chat.id).screen = "home";
    await save({ deposits: [d] });
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.reply(`${d.id} cancelled. Nothing was credited.`, { reply_markup: homeKb() });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    await expireStale();
    if (isAdmin(ctx) && desk.adminReplyTo && !["Deposit", "Buy Razer Gold", "Balance", "Orders", "Help", "Support", "Back", "Menu"].includes(text)) {
      const to = desk.adminReplyTo;
      try {
        await bot.api.sendMessage(to, text, { reply_markup: supportKb() });
        await ctx.reply(`Sent to ${to}. Send another message, or /done to stop.`);
      } catch (err) {
        await ctx.reply(`Could not send: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }
    const sess = sessionOf(ctx.chat.id);
    const user = ensureUser(ctx.chat.id, ctx.from?.username || String(ctx.from?.id));

    if (text === "Support") {
      await openSupport(ctx);
      return;
    }
    if (text === "Deposit help" || text === "Buy a card" || text === "Redeem PIN" || text === "My order" || text === "Talk to a person") {
      sess.screen = "support";
      await handleSupportText(ctx, text);
      return;
    }
    if (sess.screen === "support") {
      await handleSupportText(ctx, text);
      return;
    }
    if (text === "Deposit") {
      sess.screen = "deposit";
      await ctx.reply(
        "Choose a deposit amount, or type one — for example 24.8 or 10.\n\nThen pick BEP20 or Aptos. Network fees are paid from your wallet. Your balance updates after confirmation.",
        { reply_markup: depositKb() },
      );
      return;
    }
    if (text === "Buy Razer Gold" || text === "Amounts") {
      sess.screen = "catalog";
      const body =
        user.balanceCents <= 0
          ? "Your balance is 0.00 USDT. Deposit to continue."
          : `Razer Gold US\nBalance: ${money(user.balanceCents)} USDT\n\nChoose an amount.`;
      await ctx.reply(body, { reply_markup: catalogKb(user.balanceCents) });
      return;
    }
    if (text === "Balance") {
      await ctx.reply(`Goldroom balance: ${money(user.balanceCents)} USDT`, {
        reply_markup: homeKb(),
      });
      return;
    }
    if (text === "Help") {
      await ctx.reply(
        "1. Deposit USDT on BEP20 or Aptos — send the exact amount shown.\n2. When your balance updates, tap Buy Razer Gold.\n3. Your PIN arrives in this chat.\n\nRedeem at gold.razer.com.",
        { reply_markup: homeKb() },
      );
      return;
    }
    if (text === "Orders") {
      const mineDep = [...desk.deposits.values()]
        .filter((d) => d.chatId === ctx.chat.id)
        .slice(-6)
        .reverse();
      const mineBuy = [...desk.purchases.values()]
        .filter((p) => p.chatId === ctx.chat.id)
        .slice(-6)
        .reverse();
      const lines = [
        mineDep.length ? "Deposits" : "No deposits.",
        ...mineDep.map((d) => `${d.id}  ·  ${d.payAmount}  ·  ${d.status}`),
        "",
        mineBuy.length ? "Cards" : "No cards yet.",
        ...mineBuy.map((p) => `${p.id}  ·  $${p.denom}  ·  ${p.status}`),
      ].join("\n");
      await ctx.reply(lines, { reply_markup: homeKb() });
      return;
    }
    if (text === "Back" || text === "Menu") {
      if (sess.screen === "network") {
        sess.screen = "deposit";
        await ctx.reply("Choose a deposit amount.", { reply_markup: depositKb() });
        return;
      }
      await sendHome(ctx, "What do you need?");
      return;
    }

    const net = parseNetwork(text);
    if (net) {
      const amt = sess.depositAmount;
      if (!amt) {
        sess.screen = "deposit";
        await ctx.reply("Choose a deposit amount first.", { reply_markup: depositKb() });
        return;
      }
      await startDeposit(ctx, amt, net);
      return;
    }

    const dep = parseDepositLabel(text);
    const typed = /^\d+(?:\.\d{1,8})?$/.test(text) ? Number(text) : NaN;
    if (dep != null || (Number.isFinite(typed) && typed > 0)) {
      const amount = exactUsdt(dep ?? typed);
      if (!amount) {
        await ctx.reply("Enter an amount in USDT, for example 24.8 or 10.");
        return;
      }
      await askNetwork(ctx, amount);
      return;
    }

    const denom = parseDenomLabel(text);
    if (denom) {
      await offerCard(ctx, denom);
      return;
    }

    await ctx.reply("Use the buttons below, or type deposit, buy, balance, support, or help.", {
      reply_markup: homeKb(),
    });
  });

  bot.catch((err) => {
    console.error("bot error", err.error?.description || err.message || err);
  });
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
        supabase: Boolean(db),
        fazer: fazerConfigured(),
        ready: desk.ready,
        users: desk.users.size,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`goldroom health listening on ${PORT}`);
  await loadDesk();
  for (const d of desk.deposits.values()) {
    if (d.status === "awaiting" || d.status === "checking") void watchPayment(d.id);
  }
  for (const p of desk.purchases.values()) {
    if (p.status === "pending") void watchPurchase(p.id);
  }
  if (!bot) return;
  bot.start({
    onStart: (info) => {
      console.log(`goldroom bot @${info.username} polling`);
      if (!WALLET_BEP20) console.warn("WALLET_USDT_BEP20 is not set");
      if (!ADMIN_ID) console.warn("ADMIN_TELEGRAM_ID is not set");
      if (!fazerConfigured()) console.warn("CARD_API_KEY is not set — buys cannot hit Fazer");
    },
  });
});
