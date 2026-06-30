import { NextRequest, NextResponse } from "next/server";
import { toJaIndustry } from "@/lib/industry-map";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let crumbCache: { crumb: string; cookie: string; expiry: number } | null = null;

async function getAuth(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (crumbCache && now < crumbCache.expiry) return crumbCache;

  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "follow",
    });

    const raw = r1.headers.get("set-cookie") ?? "";
    const pairs = raw
      .split(/,(?=[A-Za-z_][A-Za-z0-9_-]*=)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean);
    const cookie = pairs.join("; ");

    const r2 = await fetch(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { "User-Agent": UA, Cookie: cookie, Accept: "*/*" } }
    );
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.startsWith("<") || crumb.length < 2) return null;

    crumbCache = { crumb, cookie, expiry: now + 3_600_000 };
    return crumbCache;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  if (!secCode || !/^[A-Za-z0-9]{4}$/.test(secCode)) {
    return NextResponse.json({ error: "Invalid secCode" }, { status: 400 });
  }

  const empty = {
    secCode,
    currentPrice: null,
    industry: null,
    yahooEps: null,
    yahooBps: null,
    yahooDps: null,
  };

  try {
    const ticker = `${secCode}.T`;
    const auth = await getAuth();

    const qs = new URLSearchParams({ symbols: ticker });
    if (auth) qs.set("crumb", auth.crumb);

    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?${qs}`,
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          ...(auth ? { Cookie: auth.cookie } : {}),
        },
      }
    );

    if (!res.ok) return NextResponse.json(empty);

    const json = await res.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q) return NextResponse.json(empty);

    // quoteから業種が取れない場合はassetProfileから取得
    let industry: string | null = q.industry ?? null;
    if (!industry && auth) {
      try {
        const profileQs = new URLSearchParams({
          modules: "assetProfile",
          crumb: auth.crumb,
        });
        const profileRes = await fetch(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?${profileQs}`,
          {
            headers: {
              "User-Agent": UA,
              Accept: "application/json",
              Cookie: auth.cookie,
            },
          }
        );
        if (profileRes.ok) {
          const profileJson = await profileRes.json();
          industry =
            profileJson?.quoteSummary?.result?.[0]?.assetProfile?.industry ??
            null;
        }
      } catch {
        // assetProfile取得失敗は無視
      }
    }

    return NextResponse.json({
      secCode,
      // 「前日終値」表記のため、ライブ価格(regularMarketPrice)ではなく
      // 前営業日の終値(regularMarketPreviousClose)を使用する。
      // PER/PBR/配当利回りはYahooの値を使わず、EDINETの実績EPS/BPS/DPSと
      // この株価から自前で算出する(呼び出し元のexportRows/calcMetrics側)。
      currentPrice: q.regularMarketPreviousClose ?? q.regularMarketPrice ?? null,
      industry: toJaIndustry(industry),
      // クロスチェック用のYahoo参考値(TTM基準のため、EDINET実績とは
      // 期間がズレる場合がある。あくまで参考表示)
      yahooEps: q.epsTrailingTwelveMonths ?? null,
      yahooBps: q.bookValue ?? null,
      yahooDps: q.trailingAnnualDividendRate ?? null,
    });
  } catch {
    return NextResponse.json(empty);
  }
}
