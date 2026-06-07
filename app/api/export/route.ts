import { NextRequest, NextResponse } from "next/server";
import { toCSV, toExcel } from "@/lib/exporter";
import type { FinancialData } from "@/types/financial";

export async function POST(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const body = await req.json() as { rows: FinancialData[] };
  const { rows } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "データがありません" }, { status: 400 });
  }

  if (format === "excel") {
    const buf = await toExcel(rows);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("財務データ")}.xlsx`,
      },
    });
  }

  // CSV (BOM付きでExcelで文字化けしないように)
  const csv = "﻿" + toCSV(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("財務データ")}.csv`,
    },
  });
}
