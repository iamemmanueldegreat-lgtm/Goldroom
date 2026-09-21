const BASE = (process.env.FAZER_API_URL || "https://api.fzr.cards/api/v2").replace(/\/$/, "");
const KEY = (process.env.CARD_API_KEY || process.env.FAZER_API_KEY || "").trim();
const FORCED_CATEGORY = (process.env.FAZER_CATEGORY_ID || "").trim();

let cache = { at: 0, categoryId: "", offers: [], hits: [] };

export function fazerConfigured() {
  return Boolean(KEY);
}

async function fzr(path, { method = "GET", body, idem } = {}) {
  if (!KEY) throw new Error("CARD_API_KEY is not set");
  const headers = {
    "X-API-Key": KEY,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idem) headers["Idempotency-Key"] = String(idem).slice(0, 255);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Math.min(30_000, (Number(res.headers.get("retry-after")) || 2) * 1000);
      await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 400)));
      lastErr = new Error("fazer HTTP 429");
      lastErr.status = 429;
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      const err = new Error(json.error || json.message || `fazer HTTP ${res.status}`);
      err.status = res.status;
      err.code = json.code;
      throw err;
    }
    return json;
  }
  throw lastErr || new Error("fazer HTTP 429");
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
    return { o, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].o : null;
}

export async function fazerBalance() {
  const data = await fzr("/balance");
  return {
    balance: String(data.balance ?? data.wallet ?? "0"),
    currency: data.currency || "USD",
  };
}

export async function listGiftcardHits() {
  const hits = [];
  let cursor = "";
  for (let i = 0; i < 25; i += 1) {
    const q = new URLSearchParams({ limit: "50" });
    if (cursor) q.set("cursor", cursor);
    const data = await fzr(`/giftcards?${q}`);
    const items = data.items || data.categories || [];
    for (const it of items) {
      const name = `${it.name || ""} ${it.title || ""} ${it.category_id || ""}`;
      if (/razer/i.test(name)) hits.push(it);
    }
    if (!data.meta?.has_more && !data.has_more) break;
    cursor = data.meta?.next_cursor || data.next_cursor || "";
    if (!cursor) break;
  }
  return hits;
}

function pickCategory(hits) {
  if (FORCED_CATEGORY) return FORCED_CATEGORY;
  const scored = hits.map((h) => {
    const blob = `${h.name || ""} ${h.category_id || ""}`.toLowerCase();
    let score = 1;
    if (/\bus\b|usd|united|usa/.test(blob)) score += 5;
    if (/gold/.test(blob)) score += 2;
    if (/pin|gift/.test(blob)) score += 1;
    return { id: h.category_id, score, name: h.name };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || "";
}

export async function razerCatalog(force = false) {
  const now = Date.now();
  if (!force && now - cache.at < 10 * 60 * 1000 && cache.offers.length && cache.categoryId) return cache;
  const hits = FORCED_CATEGORY ? [] : await listGiftcardHits();
  const categoryId = pickCategory(hits);
  if (!categoryId) {
    cache = { at: now, categoryId: "", offers: [], hits };
    return cache;
  }
  const data = await fzr(`/giftcards/cards?category_id=${encodeURIComponent(categoryId)}`);
  cache = {
    at: now,
    categoryId,
    offers: data.offers || data.items || [],
    hits,
  };
  return cache;
}

export async function getOrder(id) {
  const data = await fzr(`/orders/${encodeURIComponent(id)}`);
  return data.order || data;
}

function failedStatus(st) {
  return ["failed", "fail", "refund", "refunded", "cancelled", "canceled", "error"].includes(String(st || "").toLowerCase());
}

async function waitOrder(id, ms = 180_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < ms) {
    last = await getOrder(id);
    if (codesFrom(last).length) return last;
    const st = String(last?.status || "").toLowerCase();
    if (failedStatus(st)) {
      const err = new Error(`ORDER_FAILED:${st}`);
      err.code = "FAILED";
      err.orderId = id;
      throw err;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (last && codesFrom(last).length) return last;
  const err = new Error("PROCESSING");
  err.code = "PROCESSING";
  err.orderId = id;
  err.charged = true;
  throw err;
}

export async function buyRazerPin(denom, idem) {
  let cat = await razerCatalog();
  let offer = matchOffer(cat.offers, denom);
  if (!offer) {
    cat = await razerCatalog(true);
    offer = matchOffer(cat.offers, denom);
  }
  if (!cat.categoryId) {
    const err = new Error("NO_CATEGORY");
    err.code = "NO_OFFER";
    throw err;
  }
  if (!offer) {
    const err = new Error(`NO_OFFER:$${denom}`);
    err.code = "NO_OFFER";
    throw err;
  }
  if (offer.stock === 0 || offer.available === 0) {
    const err = new Error("OUT_OF_STOCK");
    err.code = "NO_OFFER";
    throw err;
  }
  const created = await fzr("/giftcards/order", {
    method: "POST",
    body: {
      category_id: cat.categoryId,
      card_id: offer.card_id,
      quantity: 1,
    },
    idem,
  });
  let order = created.order || created;
  const orderId = order.id;
  try {
    if (!codesFrom(order).length && orderId) {
      order = await waitOrder(orderId);
    }
    const codes = codesFrom(order);
    if (!codes.length) {
      if (orderId) {
        const err = new Error("PROCESSING");
        err.code = "PROCESSING";
        err.orderId = orderId;
        err.charged = true;
        throw err;
      }
      const err = new Error("NO_PIN");
      err.code = "NO_OFFER";
      throw err;
    }
    const serial =
      order.serial ||
      order.payload?.serial ||
      (typeof order.cards?.[0] === "object" ? order.cards[0].serial : "") ||
      "";
    return {
      orderId: order.id || idem,
      pin: codes[0],
      serial: serial || String(order.id || ""),
      costUsd: String(offer.price_usd || offer.price || ""),
      offerName: offer.name || `$${denom}`,
      categoryId: cat.categoryId,
    };
  } catch (err) {
    if (orderId) {
      err.orderId = err.orderId || orderId;
      if (err.code !== "FAILED" && err.code !== "NO_OFFER") err.charged = true;
    }
    throw err;
  }
}

export async function paymentMethods() {
  const data = await fzr("/payments/methods");
  return data.items || data.methods || [];
}

export async function methodLimits(code = "bep20") {
  const want = String(code || "bep20").toLowerCase();
  try {
    const items = await paymentMethods();
    const hit =
      items.find((m) => String(m.code || "").toLowerCase() === want) ||
      items.find((m) => new RegExp(want, "i").test(`${m.code || ""} ${m.label || ""}`));
    if (!hit) return { min: 10, max: 50000, code: want };
    return {
      code: hit.code || want,
      min: Number(hit.minAmountUsd ?? hit.min_amount ?? hit.min ?? 10) || 10,
      max: Number(hit.maxAmountUsd ?? hit.max_amount ?? hit.max ?? 50000) || 50000,
    };
  } catch {
    return { min: 10, max: 50000, code: want };
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
  const data = await fzr("/payments/create", {
    method: "POST",
    body: { method: limits.code || method, amount: n },
    idem,
  });
  const pay = normalizePayment(data);
  if (!pay?.id || !pay.address) {
    throw new Error("Payment address was not returned");
  }
  return pay;
}

export async function getPayment(id) {
  const data = await fzr(`/payments/${encodeURIComponent(id)}`);
  return normalizePayment(data);
}
