import {
  nowIso,
  upstashSetJson,
  upstashGetJson,
  fetchOkxBorrowRates,
  fetchGateUniCurrencies,
  calcOpportunities,
  telegramSend
} from "./_lib.mjs";

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

export default async () => {
  try {
    const [okxBorrowRates, gateEarnRates] = await Promise.all([
      fetchOkxBorrowRates(),
      fetchGateUniCurrencies()
    ]);

    const opps = calcOpportunities({
      okxBorrowRates,
      gateEarnRates,
      maxLoanMap: new Map(),
      allowlist: null,
      topN: 20
    });

    const payload = { asOf: nowIso(), data: opps };
    await upstashSetJson("arb:latest", payload, 600);

    // Telegram alert: send top 5 if spread >= threshold
    const threshold = Number(process.env.ALERT_SPREAD_PCT || "0");
    const top = opps.filter(x => (x.spread ?? 0) >= threshold).slice(0, 5);
    if (top.length) {
      const lines = top.map(x => `${x.coin}: Gate ${x.gateEarnApr.toFixed(2)}% - OKX ${x.okxBorrowApr.toFixed(2)}% = Spread ${x.spread.toFixed(2)}%`);
      await telegramSend("OKX × Gate APR spread:\n" + lines.join("\n"));
    }

    return jsonResponse(200, { ok:true, ...payload });
  } catch (e) {
    return jsonResponse(500, { ok:false, error: String(e?.message || e) });
  }
};
