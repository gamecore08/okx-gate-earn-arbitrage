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
    headers: { "content-type": "application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const topN = Math.max(1, Math.min(100, Number(url.searchParams.get("topN") || "20")));
    const withMaxLoan = url.searchParams.get("withMaxLoan") === "1";
    const allow = (url.searchParams.get("allow") || "").trim().toUpperCase();
    const allowset = allow ? new Set(allow.split(",").map(s => s.trim()).filter(Boolean)) : null;

    // Prefer cached result (if Upstash is configured and poll has run)
    const cached = await upstashGetJson("arb:latest");
    if (cached?.data?.length && !withMaxLoan) {
      return jsonResponse(200, { ok: true, ...cached });
    }

    const [okxBorrowRates, gateEarnRates] = await Promise.all([
      fetchOkxBorrowRates(),
      fetchGateUniCurrencies()
    ]);

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

    return jsonResponse(200, { ok:true, asOf: nowIso(), data: opps });
  } catch (e) {
    return jsonResponse(500, { ok:false, error: String(e?.message || e) });
  }
};
