import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "信用倍率", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
];

function formatRow(d: ExportRow): (string | number | null)[] {
  return [
    d.secCode ?? "", d.companyName ?? "", d.industry ?? "",
    d.currentPrice ?? "", d.per ?? "", d.pbr ?? "", d.dividendYield ?? "", d.marginRatio ?? "",
    d.periodEnd ?? "", d.netSales ?? "", d.ordinaryIncome ?? "", d.netIncome ?? "",
    d.eps ?? "", d.dps ?? "",
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
  ];
}

function toStringValues(row: (string | number | null)[]): string[] {
  return row.map((v) => (v === null || v === undefined ? "" : String(v)));
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
    return NextResponse.json(
      { error: "GOOGLE_SPREADSHEET_ID が未設定です。スプレッドシートを作成してサービスアカウントに共有してください。" },
      { status: 500 }
    );
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
  const values = [
    HEADERS,
    ...rows.map((r) => toStringValues(formatRow(r))),
  ];
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } catch (e: unknown) {
    const err = e as { message?: string; response?: { data?: unknown } };
    const detail = JSON.stringify(err.response?.data ?? err.message ?? e);
    return NextResponse.json({ error: `データ書き込み失敗: ${detail}` }, { status: 500 });
  }

  // ── Step 3: ヘッダー装飾 ───────────────────────────────────────────
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
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
          {
            autoResizeDimensions: {
              dimensions: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length },
            },
          },
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
