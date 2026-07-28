import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種",
  "前日終値（円）", "PER（倍）", "PBR（倍）", "配当利回り（%）",
  "決算期",
  "売上高（億円）", "経常利益（億円）", "最終利益（億円）", "1株利益（円）", "1株配当（円）", "発表日",
  // 理論株価 計算過程
  "計算用経常利益（億円）", "BPS（円）", "自己資本比率（%）",
  "発行済株式数・推計（株）", "計算用EPS（円）", "ROA",
  "財務レバレッジ補正", "割引評価率",
  "事業価値（円）", "資産価値（円）", "理論株価（円）",
];

// 各列の幅(px)
const COL_WIDTHS = [
  72, 150, 85,          // コード 銘柄名 業種
  95, 70, 70, 95,       // 前日終値 PER PBR 配当利回り
  70,                   // 決算期
  110, 110, 110, 85, 85, 80, // 売上〜発表日
  // 計算過程
  130, 85, 100, 150, 100, 70, 100, 80, 110, 110, 105,
];

function formatRow(d: ExportRow): (string | number | null)[] {
  return [
    d.secCode ?? "",
    d.companyName ?? "",
    d.industry ?? "",
    d.currentPrice ?? null,
    d.per ?? null,
    d.pbr ?? null,
    d.dividendYield ?? null,
    d.periodEnd ?? "",
    d.netSales != null ? d.netSales / 1e8 : null,
    d.ordinaryIncome != null ? d.ordinaryIncome / 1e8 : null,
    d.netIncome != null ? d.netIncome / 1e8 : null,
    d.eps ?? null,
    d.dps ?? null,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
    // 理論株価 計算過程
    d.calcOrdinaryIncome != null ? d.calcOrdinaryIncome / 1e8 : null,
    d.bps ?? null,
    d.equityRatioPct ?? null,
    d.sharesEstimate ?? null,
    d.calcEps ?? null,
    d.roa ?? null,
    d.leverage ?? null,
    d.discountRate ?? null,
    d.businessValue ?? null,
    d.assetValue ?? null,
    d.theoreticalPrice ?? null,
  ];
}

// 列インデックス(0始まり)→数値フォーマットのマッピング
// col 3: 前日終値, 8-10: P/L系, 12: DPS, 14: 計算用経常利益, 17: 株数, 22-24: 株価系
const NUM_FORMATS: [number[], string][] = [
  [[3, 12, 17, 22, 23, 24], "#,##0"],    // 整数円・株数
  [[8, 9, 10, 14], "#,##0.0"],           // 億円（P/L系、小数1桁）
  [[11, 15, 18], "#,##0.00"],            // EPS/BPS/calcEps（小数2桁）
  [[4, 16], "0.0"],                      // PER・自己資本比率
  [[5, 6, 20, 21], "0.00"],             // PBR・配当利回り・レバレッジ・割引評価率
  [[19], "0.0000"],                      // ROA
];

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
  const values = [HEADERS, ...rows.map(formatRow)] as (string | number | null)[][];
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
  const calcStartCol = 14; // 「計算用経常利益（円）」以降
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
          // 理論株価計算列データ行のみ薄い黄色背景
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
          // 列ごとの数値フォーマット
          ...NUM_FORMATS.flatMap(([cols, pattern]) =>
            cols.map((col) => ({
              repeatCell: {
                range: {
                  sheetId: newSheetId,
                  startRowIndex: 1, endRowIndex: dataRows + 1,
                  startColumnIndex: col, endColumnIndex: col + 1,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: "NUMBER", pattern },
                  },
                },
                fields: "userEnteredFormat.numberFormat",
              },
            }))
          ),
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
