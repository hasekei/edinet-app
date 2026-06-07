import { NextRequest, NextResponse } from "next/server";
import {
  findDocumentsBySecCode,
  findDocumentsByYearRange,
  downloadDocumentZip,
} from "@/lib/edinet-client";
import { parseXbrlZip } from "@/lib/xbrl-parser";
import type { FinancialData } from "@/types/financial";

async function fetchOne(
  secCode: string,
  docID: string,
  filerName: string,
  edinetCode: string,
  periodEnd: string,
  submitDateTime: string
): Promise<FinancialData> {
  const zipBuffer = await downloadDocumentZip(docID);
  const parsed = parseXbrlZip(zipBuffer);
  return {
    secCode,
    companyName: filerName,
    edinetCode,
    docID,
    fiscalYear: (parsed.periodEnd || periodEnd).slice(0, 4),
    periodEnd: parsed.periodEnd || periodEnd,
    submitDateTime,
    accountingStandard: parsed.accountingStandard,
    isConsolidated: parsed.isConsolidated,
    netSales: parsed.netSales,
    operatingIncome: parsed.operatingIncome,
    ordinaryIncome: parsed.ordinaryIncome,
    netIncome: parsed.netIncome,
    eps: parsed.eps,
    dps: parsed.dps,
  };
}

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  const fromYearParam = req.nextUrl.searchParams.get("fromYear");
  const toYearParam = req.nextUrl.searchParams.get("toYear");

  if (!secCode || !/^\d{4}$/.test(secCode)) {
    return NextResponse.json(
      { error: "4桁の証券コードを入力してください" },
      { status: 400 }
    );
  }

  try {
    // 年度範囲指定あり
    if (fromYearParam && toYearParam) {
      const fromYear = parseInt(fromYearParam, 10);
      const toYear = parseInt(toYearParam, 10);

      if (isNaN(fromYear) || isNaN(toYear) || fromYear > toYear) {
        return NextResponse.json({ error: "年度の指定が不正です" }, { status: 400 });
      }
      if (toYear - fromYear > 9) {
        return NextResponse.json({ error: "取得範囲は最大10年です" }, { status: 400 });
      }

      const docs = await findDocumentsByYearRange(secCode, fromYear, toYear);
      if (docs.length === 0) {
        return NextResponse.json(
          { error: "指定期間の有価証券報告書が見つかりませんでした" },
          { status: 404 }
        );
      }

      const results: FinancialData[] = [];
      for (let i = 0; i < Math.min(docs.length, 10); i++) {
        const d = docs[i];
        try {
          const data = await fetchOne(
            secCode, d.docID, d.filerName, d.edinetCode, d.periodEnd, d.submitDateTime
          );
          results.push(data);
        } catch {
          // 個別エラーはスキップ
        }
      }

      if (results.length === 0) {
        return NextResponse.json({ error: "財務データの取得に失敗しました" }, { status: 500 });
      }

      return NextResponse.json({ multiple: true, data: results });
    }

    // 単年（最新）取得
    const docs = await findDocumentsBySecCode(secCode, "120", 400);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: "有価証券報告書が見つかりませんでした" },
        { status: 404 }
      );
    }

    const latest = docs[0];
    const data = await fetchOne(
      secCode, latest.docID, latest.filerName, latest.edinetCode,
      latest.periodEnd, latest.submitDateTime
    );

    return NextResponse.json({ multiple: false, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
