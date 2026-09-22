import { FazerCardsClient, FazerCardsTimeoutError } from "fazercards";

const KEY = (process.env.CARD_API_KEY || process.env.FAZER_API_KEY || "").trim();
const FORCED_CATEGORY = (process.env.FAZER_CATEGORY_ID || "").trim();

const client = KEY
  ? new FazerCardsClient({ apiKey: KEY, appName: "goldroom", retries: 2, timeoutMs: 20_000 })
  : null;

let cache = { at: 0, categoryId: "", offers: [], hits: [] };

export function fazerConfigured() {
  return Boolean(KEY && client);
}

function codesFrom(order) {
  if (!order || typeof order !== "object") return [];
  const bags = [
    order.cards,
    order.codes,
    order.keys,
    order.items,
    order.vouchers,
    order.pins,
    order.payload?.cards,
    order.payload?.codes,
    order.payload?.items,
    order.payload?.pins,
    order.data?.cards,
    order.data?.codes,
    order.order?.cards,
    order.order?.codes,
  ];
  const out = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  for (const bag of bags) {
    if (typeof bag === "string") {
      push(bag);
      continue;
    }
    if (!Array.isArray(bag)) continue;
    for (const item of bag) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        push(item.pin || item.code || item.pin_code || item.card);
      }
    }
  }
  push(order.pin);
  push(order.code);
  push(order.pin_code);
  push(order.payload?.pin);
  push(order.payload?.code);
  return [...new Set(out)];
}

export function extractCodes(order) {
  return codesFrom(order);
}

export function matchOffer(offers, denom) {
  const list = Array.isArray(offers) ? offers : [];
  const n = Number(denom);
  const scored = list.map((o) => {
    const name = `${o.name || ""} ${o.title || ""} ${o.card_id || ""} ${o.sku || ""}`;
    let score = 0;
    if (new RegExp(`\\$${n}\\b`).test(name)) score += 8;
    if (new RegExp(`(?:^|\\s)${n}(?:\\s|USD|usd|$)`).test(name)) score += 5;
    if (new RegExp(`(?:^|[^0-9])${n}(?:\\.00)?(?:[^0-9]|$)`).test(name) && /us|usd|united/i.test(name)) score += 4;
    const face = Number(o.face_value || o.amount || o.value || o.face || o.denomination);
    if (face === n) score += 10;
    const usd = Number(o.price_usd || o.price);
    if (usd && Math.abs(usd - n) < 0.05) score += 3;
    if (new RegExp(`(?:^|[^A-Za-z0-9])${n}(?:[^A-Za-z0-9]|$)`).test(String(o.card_id || ""))) score += 2;
    if (o.card_id) score += 1;
    return { o, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top?.score || !top.o?.card_id) return null;
  return top.o;
}

export async function fazerBalance() {
  const data = await client.balance.get();
  return {
    balance: String(data.balance ?? "0"),
    currency: data.currency || "USD",
  };
}

function scoreCategory(h) {
  const blob = `${h.name || ""} ${h.category_id || ""}`.toLowerCase();
  let score = 1;
  if (/\bus\b|usd|united|usa/.test(blob)) score += 5;
  if (/gold/.test(blob)) score += 2;
  if (/pin|gift/.test(blob)) score += 1;
  return score;
}

async function listGiftcardHits() {
  const hits = [];
  if (FORCED_CATEGORY) return hits;
  let n = 0;
  for await (const it of client.giftcards.iterCategories({ limit: 100 })) {
    n += 1;
    const name = `${it.name || ""} ${it.category_id || ""}`;
    if (/razer/i.test(name)) hits.push(it);
    const blob = name.toLowerCase();
    if (/razer/.test(blob) && /gold/.test(blob) && /\bus\b|usd|united|usa/.test(blob)) break;
    if (n >= 80) break;
  }
  return hits;
}

export async function razerCatalog(force = false, denom = 0) {
  const now = Date.now();
  if (
    !force &&
    now - cache.at < 10 * 60 * 1000 &&
    cache.offers.length &&
    cache.categoryId &&
    (!denom || matchOffer(cache.offers, denom))
  ) {
    return cache;
  }
  const hits = await listGiftcardHits();
  const ranked = [...hits].sort((a, b) => scoreCategory(b) - scoreCategory(a));
  if (FORCED_CATEGORY) ranked.unshift({ category_id: FORCED_CATEGORY, name: FORCED_CATEGORY });
  let chosen = { at: now, categoryId: "", offers: [], hits };
  for (const h of ranked.slice(0, 12)) {
    if (!h?.category_id) continue;
    const data = await client.giftcards.cards(h.category_id);
    const offers = data.offers || data.items || [];
    const ok = denom
      ? Boolean(matchOffer(offers, denom))
      : [10, 20, 25, 50, 100].some((d) => matchOffer(offers, d));
    if (offers.length) {
      chosen = { at: now, categoryId: h.category_id, offers, hits };
      if (ok) {
        cache = chosen;
        return cache;
      }
    }
  }
  cache = chosen;
  return cache;
}

export async function getOrder(id) {
  return client.orders.get(id);
}

export async function listRecentOrders(limit = 15) {
  const page = await client.orders.list({ page: 1, limit });
  return page.items || [];
}

export async function waitFazerOrder(id, timeoutMs = 45_000) {
  return client.orders.wait(id, { timeoutMs, intervalMs: 5_000 });
}

function failedStatus(st) {
  return ["failed", "fail", "refund", "refunded", "cancelled", "canceled", "error"].includes(String(st || "").toLowerCase());
}

function pinFrom(order, fallbackId, costUsd, offerName, categoryId) {
  const codes = codesFrom(order);
  const serial =
    order.serial ||
    order.payload?.serial ||
    (typeof order.cards?.[0] === "object" ? order.cards[0].serial : "") ||
    "";
  return {
    orderId: order.id || fallbackId,
    pin: codes[0],
    serial: serial || String(order.id || fallbackId || ""),
    costUsd,
    offerName,
    categoryId,
  };
}

export async function buyRazerPin(denom, idem) {
  let cat = await razerCatalog(false, denom);
  let offer = matchOffer(cat.offers, denom);
  if (!offer) {
    cat = await razerCatalog(true, denom);
    offer = matchOffer(cat.offers, denom);
  }
  if (!cat.categoryId) {
    const err = new Error("NO_CATEGORY");
    err.code = "NO_OFFER";
    throw err;
  }
  if (!offer?.card_id) {
    const err = new Error(`NO_OFFER:$${denom}`);
    err.code = "NO_OFFER";
    throw err;
  }
  let order;
  try {
    order = await client.giftcards.order({
      categoryId: cat.categoryId,
      cardId: offer.card_id,
      quantity: 1,
      idempotencyKey: String(idem),
    });
  } catch (err) {
    const e = new Error(err instanceof Error ? err.message : String(err));
    e.code = "NO_OFFER";
    e.status = err.status;
    throw e;
  }
  const orderId = order?.id;
  const costUsd = String(offer.price_usd || offer.price || "");
  const offerName = offer.name || `$${denom}`;
  try {
    if (failedStatus(order?.status)) {
      const err = new Error(`ORDER_FAILED:${order.status}`);
      err.code = "FAILED";
      err.orderId = orderId;
      throw err;
    }
    if (!codesFrom(order).length && orderId) {
      try {
        order = await client.orders.wait(orderId, { timeoutMs: 60_000, intervalMs: 5_000 });
      } catch (err) {
        if (err instanceof FazerCardsTimeoutError) {
          const latest = await client.orders.get(orderId).catch(() => order);
          if (codesFrom(latest).length) order = latest;
          else {
            const e = new Error("PROCESSING");
            e.code = "PROCESSING";
            e.orderId = orderId;
            e.charged = true;
            throw e;
          }
        } else {
          throw err;
        }
      }
    }
    if (failedStatus(order?.status)) {
      const err = new Error(`ORDER_FAILED:${order.status}`);
      err.code = "FAILED";
      err.orderId = orderId;
      throw err;
    }
    if (!codesFrom(order).length) {
      const err = new Error(orderId ? "PROCESSING" : "NO_PIN");
      err.code = orderId ? "PROCESSING" : "NO_OFFER";
      err.orderId = orderId;
      err.charged = Boolean(orderId);
      throw err;
    }
    return pinFrom(order, idem, costUsd, offerName, cat.categoryId);
  } catch (err) {
    if (orderId) {
      err.orderId = err.orderId || orderId;
      if (err.code !== "FAILED" && err.code !== "NO_OFFER") err.charged = true;
    }
    throw err;
  }
}

export async function paymentMethods() {
  return client.payments.methods();
}

export async function methodLimits(code = "bep20") {
  const want = String(code || "bep20").toLowerCase();
  try {
    const items = await paymentMethods();
    const hit =
      items.find((m) => String(m.code || "").toLowerCase() === want) ||
      items.find((m) => new RegExp(want, "i").test(`${m.code || ""} ${m.label || ""}`));
    if (!hit) return { min: 3, max: 50000, code: want };
    return {
      code: hit.code || want,
      min: Number(hit.minAmountUsd ?? hit.min_amount ?? 3) || 3,
      max: Number(hit.maxAmountUsd ?? 50000) || 50000,
    };
  } catch {
    return { min: 3, max: 50000, code: want };
  }
}

export async function bep20Limits() {
  return methodLimits("bep20");
}

export function normalizePayment(raw) {
  const p = raw?.payment || raw;
  if (!p || typeof p !== "object") return null;
  const amount = p.amount ?? p.credit_amount ?? p.usd;
  const unique = p.uniqueAmount ?? p.unique_amount ?? p.send_amount;
  return {
    id: String(p.id || ""),
    address: p.address || p.wallet || p.to || "",
    sendAmount: String(unique || amount || ""),
    creditAmount: String(amount || unique || ""),
    status: String(p.status || "pending").toLowerCase(),
    expiresAt: p.expiresAt || p.expires_at || null,
    completedAt: p.completedAt || p.completed_at || null,
    cancelledAt: p.cancelledAt || p.cancelled_at || null,
    network: p.network || "BEP20",
    memo: p.memo || p.tag || "",
    raw: p,
  };
}

export async function createPayment(amount, idem, method = "bep20") {
  const limits = await methodLimits(method);
  const n = Number(amount);
  if (n < limits.min) {
    const err = new Error(`MIN:${limits.min}`);
    err.code = "MIN";
    err.min = limits.min;
    throw err;
  }
  if (n > limits.max) {
    const err = new Error(`MAX:${limits.max}`);
    err.code = "MAX";
    err.max = limits.max;
    throw err;
  }
  const pay = normalizePayment(
    await client.payments.create({ method: limits.code || method, amount: n }),
  );
  if (!pay?.id || !pay.address) {
    throw new Error("Payment address was not returned");
  }
  return pay;
}

export async function getPayment(id) {
  return normalizePayment(await client.payments.get(id));
}
