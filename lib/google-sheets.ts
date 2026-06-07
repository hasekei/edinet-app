import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "信用倍率", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
];

// ---- PKCE ヘルパー ----------------------------------------------------------

function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ---- OAuth 認可コードフロー（PKCE + サーバーサイドトークン交換）-----------

export async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID が未設定です");

  const redirectUri = `${window.location.origin}/oauth-callback`;
  const state = Math.random().toString(36).slice(2, 10);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const storageKey = `google-oauth-${state}`;

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/spreadsheets")}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}` +
    `&access_type=online`;

  const popup = window.open(authUrl, "_blank", "width=520,height=660,resizable=yes,scrollbars=yes");
  if (!popup) throw new Error("ポップアップがブロックされました。ブラウザのポップアップ許可を確認してください");

  // 認可コードを localStorage 経由で受け取る
  const code = await new Promise<string>((resolve, reject) => {
    let done = false;

    const finish = (code?: string, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      localStorage.removeItem(storageKey);
      window.removeEventListener("message", onMessage);
      try { popup.close(); } catch { /* ignore */ }
      if (error) reject(new Error(`認証エラー: ${error}`));
      else if (code) resolve(code);
      else reject(new Error("認証コードを取得できませんでした"));
    };

    // postMessage（window.opener が使える場合は即時）
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== "GOOGLE_TOKEN" || e.data.state !== state) return;
      finish(e.data.code ?? undefined, e.data.error ?? undefined);
    };
    window.addEventListener("message", onMessage);

    // localStorage ポーリング（COOP 等で postMessage が届かない場合のフォールバック）
    const pollId = setInterval(() => {
      if (done) { clearInterval(pollId); return; }

      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try {
          const { code, error } = JSON.parse(raw) as { code?: string; error?: string };
          finish(code, error);
        } catch { finish(undefined, "ストレージ解析エラー"); }
        return;
      }

      try {
        if (popup.closed) {
          clearInterval(pollId);
          setTimeout(() => {
            if (done) return;
            const late = localStorage.getItem(storageKey);
            if (late) {
              try {
                const { code, error } = JSON.parse(late) as { code?: string; error?: string };
                finish(code, error);
              } catch { finish(undefined, "ストレージ解析エラー"); }
            } else {
              finish(undefined, "認証がキャンセルされました");
            }
          }, 400);
        }
      } catch { /* ignore */ }
    }, 300);

    const timeoutId = setTimeout(() => {
      finish(undefined, "認証タイムアウト (2分)");
    }, 120_000);
  });

  // サーバーサイドルートでコードをアクセストークンに交換（client_secret はサーバー側）
  const tokenRes = await fetch("/api/google-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error ?? `トークン取得失敗 (${tokenRes.status})`);
  return tokenData.access_token;
}

// ---- Sheets API ヘルパー ----------------------------------------------------

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

function sheetsErrorMessage(status: number, body: { error?: { message?: string } }): string {
  const detail = body?.error?.message;
  if (status === 401) return "認証エラー: アクセストークンが無効です。再度ボタンを押してください";
  if (status === 403) {
    if (detail?.includes("disabled")) return "Google Sheets API が無効です。Google Cloud Console で有効にしてください";
    return `アクセス拒否 (403): ${detail ?? "権限がありません"}`;
  }
  return detail ?? `スプレッドシート作成失敗 (HTTP ${status})`;
}

async function sheetsPost(url: string, accessToken: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError")
      throw new Error("Sheets API がタイムアウトしました (30秒)");
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

export async function createGoogleSpreadsheet(rows: ExportRow[], accessToken: string): Promise<string> {
  const today = new Date()
    .toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\//g, "-");

  const rowData = [rowValues(HEADERS), ...rows.map((r) => rowValues(formatRow(r)))];

  const createRes = await sheetsPost("https://sheets.googleapis.com/v4/spreadsheets", accessToken, {
    properties: { title: `財務データ_${today}` },
    sheets: [{ properties: { title: "財務データ" }, data: [{ startRow: 0, startColumn: 0, rowData }] }],
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(sheetsErrorMessage(createRes.status, err));
  }

  const created = await createRes.json();
  const spreadsheetId: string = created.spreadsheetId;
  const sheetId: number = created.sheets?.[0]?.properties?.sheetId ?? 0;

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
