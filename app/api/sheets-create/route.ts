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
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

// 診断用エンドポイント: GET /api/sheets-create?dbg=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("dbg") !== "1") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return NextResponse.json({ env: "missing" });

  const diag: Record<string, string> = {};
  try {
    const parsed = JSON.parse(raw) as { client_email: string; private_key: string };
    diag.email = parsed.client_email;
    diag.keyStart = parsed.private_key.slice(0, 40);
  } catch (e) {
    return NextResponse.json({ parse: String(e) });
  }

  let auth: ReturnType<typeof buildAuth>;
  try {
    auth = buildAuth(raw);
    await auth.authorize();
    diag.authorize = "OK";
  } catch (e) {
    diag.authorize = `FAIL: ${e}`;
    return NextResponse.json(diag);
  }

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const about = await drive.about.get({ fields: "user" });
    diag.driveAbout = `OK: ${about.data.user?.emailAddress ?? "no email"}`;
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown } };
    diag.driveAbout = `FAIL [${err.response?.status}]: ${JSON.stringify(err.response?.data)}`;
  }

  try {
    const res = await drive.files.create({
      requestBody: { name: "diag-test", mimeType: "application/vnd.google-apps.spreadsheet" },
      fields: "id",
    });
    diag.driveCreate = `OK: ${res.data.id}`;
    // 作成できたら削除
    await drive.files.delete({ fileId: res.data.id! }).catch(() => null);
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown } };
    diag.driveCreate = `FAIL [${err.response?.status}]: ${JSON.stringify(err.response?.data)}`;
  }

  try {
    const res = await sheets.spreadsheets.create({
      requestBody: { properties: { title: "diag-test" } },
    });
    diag.sheetsCreate = `OK: ${res.data.spreadsheetId}`;
    await drive.files.delete({ fileId: res.data.spreadsheetId! }).catch(() => null);
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown } };
    diag.sheetsCreate = `FAIL [${err.response?.status}]: ${JSON.stringify(err.response?.data)}`;
  }

  return NextResponse.json(diag);
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

  let clientEmail: string;
  let privateKey: string;
  try {
    const parsed = JSON.parse(raw) as { client_email: string; private_key: string };
    clientEmail = parsed.client_email;
    // Vercel env var でエスケープされた \n を実際の改行に戻す
    privateKey = parsed.private_key.replace(/\\n/g, "\n");
  } catch (e) {
    return NextResponse.json({ error: `JSON解析失敗: ${e}` }, { status: 500 });
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  try {
    await auth.authorize();
  } catch (e) {
    return NextResponse.json({ error: `JWT認証失敗: ${e}` }, { status: 500 });
  }

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  const today = new Date()
    .toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\//g, "-");

  // ── Step 1: Drive API でスプレッドシートを作成 ───────────────────────
  let spreadsheetId: string;
  const sheetId = 0;
  try {
    const createRes = await drive.files.create({
      requestBody: {
        name: `財務データ_${today}`,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      fields: "id",
    });
    spreadsheetId = createRes.data.id!;
  } catch (e: unknown) {
    const err = e as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = JSON.stringify(err.response?.data ?? err.message ?? e);
    return NextResponse.json(
      { error: `スプレッドシート作成失敗 [${err.response?.status ?? "?"}]: ${detail}` },
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
      range: "A1",
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
    // 装飾失敗は無視
  }

  // ── Step 4: 権限設定（誰でも編集可）──────────────────────────────
  try {
    await drive.permissions.create({
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
