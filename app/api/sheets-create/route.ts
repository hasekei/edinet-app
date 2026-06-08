import { createSign } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { ExportRow } from "@/types/financial";

// ---- サービスアカウント JWT → アクセストークン ---------------------------------

function b64url(s: string): string {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function getServiceAccountToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が未設定です");

  const key = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const payload = `${header}.${claims}`;
  const sign = createSign("RSA-SHA256");
  sign.update(payload);
  const sig = sign
    .sign(key.private_key, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const jwt = `${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`トークン取得失敗: ${data.error_description ?? data.error}`);
  return data.access_token as string;
}

// ---- Sheets API ヘルパー -------------------------------------------------------

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

async function sheetsPost(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- POST handler -------------------------------------------------------------

export async function POST(req: NextRequest) {
  const { rows } = (await req.json()) as { rows: ExportRow[] };

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "データがありません" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getServiceAccountToken();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "認証エラー" },
      { status: 500 }
    );
  }

  const today = new Date()
    .toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\//g, "-");

  const rowData = [rowValues(HEADERS), ...rows.map((r) => rowValues(formatRow(r)))];

  const createRes = await sheetsPost("https://sheets.googleapis.com/v4/spreadsheets", token, {
    properties: { title: `財務データ_${today}` },
    sheets: [{ properties: { title: "財務データ" }, data: [{ startRow: 0, startColumn: 0, rowData }] }],
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message ?? `HTTP ${createRes.status}`;
    return NextResponse.json({ error: `スプレッドシート作成失敗: ${msg}` }, { status: 500 });
  }

  const created = await createRes.json();
  const spreadsheetId: string = created.spreadsheetId;
  const sheetId: number = created.sheets?.[0]?.properties?.sheetId ?? 0;

  // ヘッダー装飾
  await sheetsPost(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    token,
    {
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
    }
  );

  // 「リンクを知っている全員が閲覧可能」に設定
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "anyone" }),
    }
  );

  return NextResponse.json({
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  });
}
