import { NextRequest, NextResponse } from "next/server";
import { findDocumentsBySecCode, downloadDocumentZip } from "@/lib/edinet-client";
import { parseForecastXbrl } from "@/lib/xbrl-parser";
import type { ForecastData } from "@/types/financial";

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  if (!secCode || !/^\d{4}$/.test(secCode)) {
    return NextResponse.json({ error: "Invalid secCode" }, { status: 400 });
  }

  try {
    // 最新の決算短信 (docTypeCode=140) を取得
    const docs = await findDocumentsBySecCode(secCode, "140", 400);
    if (docs.length === 0) {
      const result: ForecastData = { secCode, forecastOrdinaryIncome: null, bps: null, equityRatio: null };
      return NextResponse.json(result);
    }

    const latest = docs[0];
    const zipBuffer = await downloadDocumentZip(latest.docID);
    const parsed = parseForecastXbrl(zipBuffer);

    const result: ForecastData = {
      secCode,
      forecastOrdinaryIncome: parsed.forecastOrdinaryIncome,
      bps: parsed.bps,
      equityRatio: parsed.equityRatio,
    };

    return NextResponse.json(result);
  } catch {
    const result: ForecastData = { secCode, forecastOrdinaryIncome: null, bps: null, equityRatio: null };
    return NextResponse.json(result);
  }
}
