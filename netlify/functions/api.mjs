import {
  nowIso,
  upstashGetJson,
  fetchOkxBorrowRates,
  fetchGateUniCurrencies,
  fetchOkxMaxLoan,
  calcOpportunities,
  sleep
} from "./_lib.mjs";

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default async (req) => {
  try {
    const url = new URL(req.url);

    const topN = Math.max(1, Math.min(100, Number(url.searchParams.get("topN") || "20")));
    const withMaxLoan = url.searchParams.get("withMaxLoan") === "1";
    const debug = url.searchParams.get("debug") === "1";

    const allow = (url.searchParams.get("allow") || "").trim().toUpperCase();
    const allowset = allow ? new Set(allow.split(",").map(s => s.trim()).filter(Boolean)) : null;

    // Prefer cached result (if Upstash is configured and poll has run)
    // IMPORTANT: bypass cache in debug mode, so we can see live counts/samples
    if (!debug) {
      const cached = await upstashGetJson("arb:latest");
      if (cached?.data?.length && !withMaxLoan) {
        return jsonResponse(200, { ok: true, ...cached });
      }
    }

    const [okxBorrowRates, gateEarnRates] = await Promise.all([
      fetchOkxBorrowRates(),
      fetchGateUniCurrencies()
    ]);

    // --- DEBUG output (before ranking) ---
    if (debug) {
      const norm = (s) => String(s ?? "").trim().toUpperCase();

      const okxSet = new Set(okxBorrowRates.map(x => norm(x.ccy)));
      const intersectionSample = gateEarnRates
        .map(x => norm(x.ccy))
        .filter(c => okxSet.has(c))
        .slice(0, 50);

      return jsonResponse(200, {
        ok: true,
        asOf: nowIso(),
        debug: {
          okxCount: okxBorrowRates.length,
          gateCount: gateEarnRates.length,
          okxSample: okxBorrowRates.slice(0, 5),
          gateSample: gateEarnRates.slice(0, 5),
          okxKeys: okxBorrowRates.slice(0, 50).map(x => norm(x.ccy)),
          gateKeys: gateEarnRates.slice(0, 50).map(x => norm(x.ccy)),
          intersectionSample
        }
      });
    }

    // Base opportunities (fast)
    let maxLoanMap = new Map();
    let opps = calcOpportunities({
      okxBorrowRates,
      gateEarnRates,
      maxLoanMap,
      allowlist: allowset,
      topN
    });

    // Optional: enrich with OKX max loan/quota (slower due to rate limit)
    if (withMaxLoan) {
      for (const row of opps) {
        const r = await fetchOkxMaxLoan(row.coin);
        if (r) {
          maxLoanMap.set(row.coin, r);
        } else {
          row.note = row.note || "OKX max-loan not available (check API env/perm)";
        }
        // OKX limit: 5 requests / 2 seconds → ~450ms spacing
        await sleep(450);
      }

      // recompute with maxLoanMap
      opps = calcOpportunities({
        okxBorrowRates,
        gateEarnRates,
        maxLoanMap,
        allowlist: allowset,
        topN
      });
    }

    return jsonResponse(200, { ok: true, asOf: nowIso(), data: opps });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: String(e?.message || e) });
  }
};
