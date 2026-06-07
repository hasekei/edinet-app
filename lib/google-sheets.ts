import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "信用倍率", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
];

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

function loadGIS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") { resolve(); return; }
    if (window.google?.accounts) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google認証ライブラリの読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

export async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID が未設定です。Vercel の環境変数を確認してください"
    );
  }
  await loadGIS();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("認証タイムアウト。ポップアップがブロックされていないか確認してください")),
      120_000
    );
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: (r) => {
        clearTimeout(timeout);
        if (r.error || !r.access_token) reject(new Error(r.error ?? "Google 認証失敗"));
        else resolve(r.access_token);
      },
    });
    client.requestAccessToken();
  });
}

type CellValue = string | number | null;

function cell(v: CellValue) {
  if (v === null || v === undefined || v === "") {
    return { userEnteredValue: { stringValue: "" } };
  }
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: String(v) } };
}

function rowValues(cells: CellValue[]) {
  return { values: cells.map(cell) };
}

function formatRow(d: ExportRow): CellValue[] {
  return [
    d.secCode,
    d.companyName,
    d.industry ?? "",
    d.currentPrice,
    d.per,
    d.pbr,
    d.dividendYield,
    d.marginRatio,
    d.periodEnd,
    d.netSales,
    d.ordinaryIncome,
    d.netIncome,
    d.eps,
    d.dps,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
  ];
}

function sheetsErrorMessage(status: number, body: { error?: { message?: string } }): string {
  const detail = body?.error?.message;
  if (status === 401) return `認証エラー: アクセストークンが無効です。再度ボタンを押してください`;
  if (status === 403) {
    if (detail?.includes("disabled")) return "Google Sheets API が無効です。Google Cloud Console で Sheets API を有効にしてください";
    if (detail?.includes("PERMISSION_DENIED") || detail?.includes("insufficientPermissions"))
      return "権限不足。スコープ spreadsheets が付与されているか確認してください";
    return `アクセス拒否 (403): ${detail ?? "権限がありません"}`;
  }
  return detail ?? `スプレッドシート作成失敗 (HTTP ${status})`;
}

async function sheetsPost(url: string, accessToken: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Sheets API がタイムアウトしました (30秒)。ネットワークを確認してください");
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

export async function createGoogleSpreadsheet(
  rows: ExportRow[],
  accessToken: string
): Promise<string> {
  const today = new Date()
    .toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\//g, "-");
  const title = `財務データ_${today}`;

  const rowData = [rowValues(HEADERS), ...rows.map((r) => rowValues(formatRow(r)))];

  const createRes = await sheetsPost(
    "https://sheets.googleapis.com/v4/spreadsheets",
    accessToken,
    {
      properties: { title },
      sheets: [{ properties: { title: "財務データ" }, data: [{ startRow: 0, startColumn: 0, rowData }] }],
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(sheetsErrorMessage(createRes.status, err));
  }

  const created = await createRes.json();
  const spreadsheetId: string = created.spreadsheetId;
  const sheetId: number = created.sheets?.[0]?.properties?.sheetId ?? 0;

  // ヘッダー装飾・列幅自動調整・先頭行固定
  await sheetsPost(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    accessToken,
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

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}
