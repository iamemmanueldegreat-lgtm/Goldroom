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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const err = new Error(json.error || json.message || `fazer HTTP ${res.status}`);
    err.status = res.status;
    err.code = json.code;
    throw err;
  }
  return json;
}

function codesFrom(order) {
  if (!order || typeof order !== "object") return [];
  const bags = [order.cards, order.codes, order.keys, order.payload?.cards, order.payload?.codes];
  const out = [];
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const item of bag) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else if (item && typeof item === "object") {
        const v = item.pin || item.code || item.card || item.serial || item.value;
        if (typeof v === "string" && v.trim()) out.push(v.trim());
      }
    }
  }
  return out;
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

export function matchOffer(offers, denom) {
  const list = Array.isArray(offers) ? offers : [];
  const exact = list.find((o) => {
    const name = `${o.name || ""} ${o.card_id || ""}`;
    return new RegExp(`\\$${denom}\\b`).test(name) || new RegExp(`(?:^|\\s)${denom}(?:\\s|$)`).test(name);
  });
  if (exact) return exact;
  return list.find((o) => String(o.face_value || o.amount || o.value) === String(denom)) || null;
}

export async function razerCatalog() {
  const now = Date.now();
  if (now - cache.at < 45_000 && cache.offers.length && cache.categoryId) return cache;
  const hits = await listGiftcardHits();
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

async function waitOrder(id, ms = 90_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < ms) {
    const data = await fzr(`/orders/${encodeURIComponent(id)}`);
    last = data.order || data;
    const st = String(last.status || "").toLowerCase();
    if (["completed", "complete", "success", "delivered"].includes(st)) return last;
    if (["failed", "fail", "refund", "refunded", "cancelled", "canceled", "error"].includes(st)) {
      throw new Error(`Fazer order ${st}`);
    }
    if (codesFrom(last).length) return last;
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (last && codesFrom(last).length) return last;
  throw new Error("Fazer order timed out — balance was not taken twice, refund the buyer in Goldroom if needed");
}

export async function buyRazerPin(denom, idem) {
  const cat = await razerCatalog();
  if (!cat.categoryId) {
    throw new Error("No Razer Gold category on Fazer. Set FAZER_CATEGORY_ID.");
  }
  const offer = matchOffer(cat.offers, denom);
  if (!offer) {
    throw new Error(`Fazer has no $${denom} Razer Gold offer right now.`);
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
  if (!codesFrom(order).length && order.id) {
    order = await waitOrder(order.id);
  }
  const codes = codesFrom(order);
  if (!codes.length) {
    throw new Error("Fazer completed without a PIN. Check the Fazer dashboard.");
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
}

export async function paymentMethods() {
  const data = await fzr("/payments/methods");
  return data.items || data.methods || [];
}

export async function bep20Limits() {
  try {
    const items = await paymentMethods();
    const bep = items.find((m) => /bep20/i.test(`${m.code || ""} ${m.label || ""}`)) || items[0];
    if (!bep) return { min: 10, max: 50000, code: "bep20" };
    return {
      code: bep.code || "bep20",
      min: Number(bep.minAmountUsd ?? bep.min_amount ?? bep.min ?? 10) || 10,
      max: Number(bep.maxAmountUsd ?? bep.max_amount ?? bep.max ?? 50000) || 50000,
    };
  } catch {
    return { min: 10, max: 50000, code: "bep20" };
  }
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
    network: p.network || "BEP20",
    memo: p.memo || p.tag || "",
    raw: p,
  };
}

export async function createPayment(amount, idem) {
  const limits = await bep20Limits();
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
    body: { method: limits.code || "bep20", amount: n },
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
