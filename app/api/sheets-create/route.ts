import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
  // 理論株価 計算過程
  "予想経常利益", "BPS", "自己資本比率(%)",
  "発行済株式数（推計）", "計算用EPS", "ROA",
  "財務レバレッジ補正", "割引評価率", "事業価値", "資産価値", "理論株価",
];

// 各列の幅(px)
const COL_WIDTHS = [
  72, 150, 85,   // コード 銘柄名 業種
  80, 55, 55, 80, // 終値 PER PBR 利回
  70,             // 決算期
  105, 105, 105, 75, 75, 80, // 売上〜発表日
  // 計算過程
  105, 75, 80, 110, 80, 70, 80, 75, 105, 105, 95,
];

function formatJPY(v: number | null | undefined): string {
  if (v == null) return "";
  const negative = v < 0;
  const abs = Math.abs(v);

  const fmt = (n: number, dec = 0) =>
    new Intl.NumberFormat("ja-JP", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

  let text: string;
  if (abs >= 1e8) {
    if (abs >= 1e12) text = fmt(v / 1e12, 1) + " 兆円";
    else text = fmt(Math.round(v / 1e8)) + " 億円";
  } else {
    if (abs >= 1_000_000) text = fmt(v / 1_000_000, 1) + " 兆円";
    else if (abs >= 10_000) text = fmt(Math.round(v / 100)) + " 億円";
    else if (abs >= 100) text = fmt(v / 100, 1) + " 億円";
    else text = fmt(v) + " 百万円";
  }

  return negative ? `▼ ${text}` : text;
}

function formatRow(d: ExportRow): string[] {
  const n = (v: number | null, dec = 1) =>
    v == null ? "" : new Intl.NumberFormat("ja-JP", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);

  const pct = (v: number | null) => v == null ? "" : n(v, 1) + "%";

  return [
    d.secCode ?? "",
    d.companyName ?? "",
    d.industry ?? "",
    d.currentPrice != null ? new Intl.NumberFormat("ja-JP").format(d.currentPrice) + "円" : "",
    n(d.per),
    n(d.pbr),
    d.dividendYield != null ? n(d.dividendYield, 2) + "%" : "",
    d.periodEnd ?? "",
    formatJPY(d.netSales),
    formatJPY(d.ordinaryIncome),
    formatJPY(d.netIncome),
    d.eps != null ? n(d.eps) + "円" : "",
    d.dps != null ? new Intl.NumberFormat("ja-JP").format(d.dps) + "円" : "",
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
    // 理論株価 計算過程
    formatJPY(d.forecastOrdinaryIncome),
    d.bps != null ? new Intl.NumberFormat("ja-JP").format(Math.round(d.bps)) + "円" : "",
    pct(d.equityRatioPct),
    d.sharesEstimate != null ? new Intl.NumberFormat("ja-JP").format(d.sharesEstimate) + "株" : "",
    d.calcEps != null ? n(d.calcEps, 2) + "円" : "",
    d.roa != null ? n(d.roa * 100, 2) + "%" : "",
    d.leverage != null ? String(d.leverage) : "",
    d.discountRate != null ? n(d.discountRate * 100, 1) + "%" : "",
    d.businessValue != null ? new Intl.NumberFormat("ja-JP").format(d.businessValue) + "円" : "",
    d.assetValue != null ? new Intl.NumberFormat("ja-JP").format(d.assetValue) + "円" : "",
    d.theoreticalPrice != null ? new Intl.NumberFormat("ja-JP").format(d.theoreticalPrice) + "円" : "",
  ];
}

function buildAuth(raw: string) {
  const parsed = JSON.parse(raw) as { client_email: string; private_key: string };
  return new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function POST(req: NextRequest) {
  const { rows } = (await req.json()) as { rows: ExportRow[] };

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "データがありません" }, { status: 400 });
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return NextResponse.json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON が未設定です" }, { status: 500 });
  }

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.replace(/^﻿/, "").trim();
  if (!spreadsheetId) {
    return NextResponse.json({ error: "GOOGLE_SPREADSHEET_ID が未設定です。" }, { status: 500 });
  }

  let auth: ReturnType<typeof buildAuth>;
  try {
    auth = buildAuth(raw);
    await auth.authorize();
  } catch (e) {
    return NextResponse.json({ error: `JWT認証失敗: ${e}` }, { status: 500 });
  }

  const sheets = google.sheets({ version: "v4", auth });

  const now = new Date();
  const sheetTitle = now.toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).replace(/\//g, "-");

  // ── Step 1: 新しいシートタブを追加 ──────────────────────────────────
  let newSheetId: number;
  try {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    });
    newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  } catch (e: unknown) {
    const err = e as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = JSON.stringify(err.response?.data ?? err.message ?? e);
    return NextResponse.json(
      { error: `シート追加失敗 [${err.response?.status ?? "?"}]: ${detail}` },
      { status: 500 }
    );
  }

  // ── Step 2: データを書き込み ────────────────────────────────────────
  const values = [HEADERS, ...rows.map(formatRow)];
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } catch (e: unknown) {
    const err = e as { message?: string; response?: { data?: unknown } };
    const detail = JSON.stringify(err.response?.data ?? err.message ?? e);
    return NextResponse.json({ error: `データ書き込み失敗: ${detail}` }, { status: 500 });
  }

  // ── Step 3: 書式設定 ───────────────────────────────────────────────
  const dataRows = rows.length;
  const totalCols = HEADERS.length;
  const calcStartCol = 14; // 「予想経常利益」以降
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // ヘッダー（主要列 0-13）: 濃い紺色
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 0, endRowIndex: 1,
                startColumnIndex: 0, endColumnIndex: calcStartCol,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.122, green: 0.22, blue: 0.392 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            },
          },
          // ヘッダー（理論株価計算列 14-24）: 濃いアンバー
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 0, endRowIndex: 1,
                startColumnIndex: calcStartCol, endColumnIndex: totalCols,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.537, green: 0.329, blue: 0.012 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            },
          },
          // データ行（数値列）右揃え
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 1, endRowIndex: dataRows + 1,
                startColumnIndex: 3, endColumnIndex: totalCols,
              },
              cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } },
              fields: "userEnteredFormat.horizontalAlignment",
            },
          },
          // 理論株価計算列データ行のみ薄い黄色背景（ヘッダーは除く）
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 1, endRowIndex: dataRows + 1,
                startColumnIndex: calcStartCol, endColumnIndex: totalCols,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 1, green: 0.976, blue: 0.863 },
                },
              },
              fields: "userEnteredFormat.backgroundColor",
            },
          },
          // 計算列の左端に太い縦線（セクション区切り）
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 0, endRowIndex: dataRows + 1,
                startColumnIndex: calcStartCol, endColumnIndex: calcStartCol + 1,
              },
              cell: {
                userEnteredFormat: {
                  borders: {
                    left: { style: "MEDIUM", color: { red: 0.537, green: 0.329, blue: 0.012 } },
                  },
                },
              },
              fields: "userEnteredFormat.borders.left",
            },
          },
          // 全列幅を設定
          ...COL_WIDTHS.map((pixelSize, i) => ({
            updateDimensionProperties: {
              range: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
              properties: { pixelSize },
              fields: "pixelSize",
            },
          })),
          // 1行目を固定
          {
            updateSheetProperties: {
              properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
  } catch {
    // 装飾失敗は無視
  }

  return NextResponse.json({
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}#gid=${newSheetId}`,
  });
}
