import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "信用倍率", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
];

type CellValue = string | number | null;

function cell(v: CellValue) {
  if (v === null || v === undefined || v === "") return { userEnteredValue: { stringValue: "" } };
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: String(v) } };
}

function rowValues(cells: CellValue[]) {
  return { values: cells.map(cell) };
}

function formatRow(d: ExportRow): CellValue[] {
  return [
    d.secCode, d.companyName, d.industry ?? "",
    d.currentPrice, d.per, d.pbr, d.dividendYield, d.marginRatio,
    d.periodEnd, d.netSales, d.ordinaryIncome, d.netIncome, d.eps, d.dps,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
  ];
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

  let credentials: object;
  try {
    credentials = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "サービスアカウントJSONの解析に失敗しました" }, { status: 500 });
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  const sheetsClient = google.sheets({ version: "v4", auth });
  const driveClient = google.drive({ version: "v3", auth });

  const today = new Date()
    .toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\//g, "-");

  const rowData = [rowValues(HEADERS), ...rows.map((r) => rowValues(formatRow(r)))];

  let spreadsheetId: string;
  let sheetId: number;

  try {
    const createRes = await sheetsClient.spreadsheets.create({
      requestBody: {
        properties: { title: `財務データ_${today}` },
        sheets: [{
          properties: { title: "財務データ" },
          data: [{ startRow: 0, startColumn: 0, rowData }],
        }],
      },
    });
    spreadsheetId = createRes.data.spreadsheetId!;
    sheetId = createRes.data.sheets?.[0]?.properties?.sheetId ?? 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `スプレッドシート作成失敗: ${msg}` }, { status: 500 });
  }

  // ヘッダー装飾
  try {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
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
              dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length },
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
  } catch {
    // 装飾失敗は無視して続行
  }

  // 「リンクを知っている全員が編集可能」に設定
  try {
    await driveClient.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: "writer", type: "anyone" },
    });
  } catch {
    // 権限設定失敗は無視して続行
  }

  return NextResponse.json({
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  });
}
