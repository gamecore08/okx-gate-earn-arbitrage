// Shared helpers (Node 18+ has global fetch)
import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function toNum(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normCcy(x) {
  return String(x ?? "").trim().toUpperCase();
}

export async function httpGetJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = (json && (json.msg || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(`GET ${url} failed: ${res.status} ${msg}`);
  }
  return json;
}

export async function httpPostJson(url, bodyObj, headers = {}) {
  const body = JSON.stringify(bodyObj ?? {});
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = (json && (json.msg || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(`POST ${url} failed: ${res.status} ${msg}`);
  }
  return json;
}

// -------------------- Upstash (optional) --------------------
export async function upstashGetJson(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json();
  const val = json?.result;
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
}

export async function upstashSetJson(key, value, ttlSeconds = 600) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type":"application/json" },
    body: JSON.stringify({ value: JSON.stringify(value), ex: ttlSeconds })
  });
  return res.ok;
}

// -------------------- Telegram (optional) --------------------
export async function telegramSend(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok:false, skipped:true };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method:"POST",
    headers:{ "content-type":"application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview:true })
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

// -------------------- OKX --------------------
export async function fetchOkxBorrowRates() {
  const url = "https://www.okx.com/api/v5/public/interest-rate-loan-quota";
  const json = await httpGetJson(url);
  const rows = Array.isArray(json?.data) ? json.data : [];

  // Normalize to APR% (annual)
  // OKX field often = DAILY rate (decimal or percent). We convert to DAILY % then *365.
  const out = [];
  for (const r of rows) {
    const ccy = normCcy(r.ccy || r.currency);
    const ir = r.interestRate ?? r.ir ?? r.rate;
    let daily = toNum(ir);
    if (!ccy || daily === null) continue;

    // heuristic: if 0 < daily < 1 => decimal (e.g. 0.000057) OR percent-decimal (0.081)
    // Convert to DAILY percent:
    if (daily > 0 && daily < 1) daily = daily * 100;

    const borrowAprPct = daily * 365; // annual APR %
    if (!Number.isFinite(borrowAprPct) || borrowAprPct <= 0) continue;

    out.push({ ccy, borrowAprPct });
  }
  return out;
}

function okxSign({ method, path, body }) {
  const apiKey = process.env.OKX_API_KEY;
  const secret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_API_PASSPHRASE;
  if (!apiKey || !secret || !passphrase) return null;

  const ts = new Date().toISOString();
  const prehash = ts + method.toUpperCase() + path + (body ? JSON.stringify(body) : "");
  const hmac = crypto.createHmac("sha256", secret).update(prehash).digest("base64");

  return {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": hmac,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": passphrase
  };
}

export async function fetchOkxMaxLoan(borrowCcy) {
  const path = "/api/v5/finance/flexible-loan/max-loan";
  const url = "https://www.okx.com" + path;
  const body = { borrowCcy };
  const headers = okxSign({ method:"POST", path, body });
  if (!headers) return null; // not configured
  const json = await httpPostJson(url, body, headers);
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  if (!row) return null;
  return {
    borrowCcy: row.borrowCcy,
    maxLoan: row.maxLoan,
    remainingQuota: row.remainingQuota
  };
}

// -------------------- Gate Earn (Uni) --------------------
export async function fetchGateUniCurrencies() {
  const url = "https://api.gateio.ws/api/v4/earn/uni/currencies";
  const rows = await httpGetJson(url);

  // Gate returns DAILY rate as strings: max_rate / min_rate
  // Convert to APR%: daily * 365 * 100
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const ccy = normCcy(r.currency || r.ccy);
    const maxRate = toNum(r.max_rate);
    const minRate = toNum(r.min_rate);

    const daily = (maxRate !== null && maxRate > 0) ? maxRate
               : ((minRate !== null && minRate > 0) ? minRate : null);

    if (!ccy || daily === null) continue;

    const earnAprPct = daily * 365 * 100; // annual APR %
    if (!Number.isFinite(earnAprPct) || earnAprPct <= 0) continue;

    out.push({ ccy, earnAprPct, dailyRate: daily });
  }
  return out;
}

// -------------------- Ranking --------------------
export function calcOpportunities({ okxBorrowRates, gateEarnRates, maxLoanMap, allowlist, topN }) {
  const okxMap = new Map(
    (okxBorrowRates || [])
      .filter(x => x?.ccy)
      .map(x => [normCcy(x.ccy), toNum(x.borrowAprPct)])
      .filter(([, v]) => v !== null)
  );

  const gateMap = new Map(
    (gateEarnRates || [])
      .filter(x => x?.ccy)
      .map(x => [normCcy(x.ccy), toNum(x.earnAprPct)])
      .filter(([, v]) => v !== null)
  );

  // intersection Gate ∩ OKX (biar spread valid)
  const coins = [...gateMap.keys()].filter(c => okxMap.has(c));

  const rows = [];
  for (const coin of coins) {
    if (allowlist && allowlist.size && !allowlist.has(coin)) continue;

    const okxBorrowApr = okxMap.get(coin);
    const gateEarnApr = gateMap.get(coin);
    if (okxBorrowApr === null || gateEarnApr === null) continue;

    const spread = gateEarnApr - okxBorrowApr;

    rows.push({
      coin,
      okxBorrowApr,
      gateEarnApr,
      spread,
      okxMaxLoan: maxLoanMap?.get(coin)?.maxLoan ?? null,
      okxRemainingQuota: maxLoanMap?.get(coin)?.remainingQuota ?? null,
      note: ""
    });
  }

  rows.sort((a,b) => (b.spread ?? -1e9) - (a.spread ?? -1e9));
  return rows.slice(0, topN || 20);
}

