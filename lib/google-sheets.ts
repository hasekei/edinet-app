import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード", "銘柄名", "業種", "前日終値", "PER", "PBR",
  "配当利回り(%)", "信用倍率", "決算期", "売上高", "経常利益",
  "最終利益", "1株利益", "1株配当", "発表日",
];

// GIS ライブラリを使わず標準 OAuth implicit flow で直接トークン取得。
// popup → localhost storage → 親ウィンドウ の通信経路を使うことで
// Cross-Origin-Opener-Policy などブラウザのセキュリティポリシーを回避。
export async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID が未設定です");

  const redirectUri = `${window.location.origin}/oauth-callback`;
  const state = Math.random().toString(36).slice(2, 10);
  const storageKey = `google-oauth-${state}`;

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/spreadsheets")}` +
    `&state=${state}`;

  const popup = window.open(authUrl, "_blank", "width=520,height=660,resizable=yes,scrollbars=yes");
  if (!popup) throw new Error("ポップアップがブロックされました。ブラウザのポップアップ許可を確認してください");

  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (token?: string | null, error?: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      localStorage.removeItem(storageKey);
      try { popup.close(); } catch { /* ignore */ }
      if (error) reject(new Error(`認証エラー: ${error}`));
      else if (token) resolve(token);
      else reject(new Error("アクセストークンを取得できませんでした"));
    };

    // postMessage 経由（window.opener が使える場合は即時）
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== "GOOGLE_TOKEN" || e.data.state !== state) return;
      window.removeEventListener("message", onMessage);
      finish(e.data.accessToken, e.data.error);
    };
    window.addEventListener("message", onMessage);

    // localStorage ポーリング（COOP で postMessage が届かない場合のフォールバック）
    const pollId = setInterval(() => {
      if (done) { clearInterval(pollId); return; }

      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try {
          const { token, error } = JSON.parse(raw) as { token?: string; error?: string };
          window.removeEventListener("message", onMessage);
          finish(token, error);
        } catch {
          finish(undefined, "ストレージ解析エラー");
        }
        return;
      }

      // popup が閉じていたらもう少し待ってから諦める
      try {
        if (popup.closed) {
          setTimeout(() => {
            if (done) return;
            const late = localStorage.getItem(storageKey);
            window.removeEventListener("message", onMessage);
            if (late) {
              try {
                const { token, error } = JSON.parse(late) as { token?: string; error?: string };
                finish(token, error);
              } catch { finish(undefined, "ストレージ解析エラー"); }
            } else {
              finish(undefined, "認証がキャンセルされました");
            }
          }, 400);
          clearInterval(pollId);
        }
      } catch { /* ignore */ }
    }, 300);

    // 2 分タイムアウト
    const timeoutId = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      finish(undefined,
        "認証タイムアウト (2分)。\n" +
        "Google Cloud Console → 認証情報 → OAuth クライアント → " +
        "「承認済みのリダイレクト URI」に https://edinet-app-two.vercel.app/oauth-callback が登録されているか確認してください"
      );
    }, 120_000);
  });
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
    if (detail?.includes("disabled")) return "Google Sheets API が無効です。Google Cloud Console で Sheets API を有効にしてください";
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
      throw new Error("Sheets API がタイムアウトしました (30秒)。ネットワークを確認してください");
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
