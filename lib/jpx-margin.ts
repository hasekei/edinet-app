import ExcelJS from "exceljs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER =
  "https://www.jpx.co.jp/markets/statistics-equities/margin/index.html";

// Vercel インスタンス単位のメモリキャッシュ（週次データなので週が変わるまで有効）
let marginCache: { friday: string; data: Map<string, number | null> } | null =
  null;

/** 直近の金曜日の YYYYMMDD を返す（JST 基準） */
function getLastFriday(): string {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  const day = now.getDay(); // 0=日, 1=月, …, 5=金, 6=土
  // 金曜を基準に daysAgo 日さかのぼる
  const daysAgo = [2, 3, 4, 5, 6, 0, 1][day]; // 日→2, 月→3, …, 金→0, 土→1
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysAgo);
  const y = friday.getFullYear();
  const m = String(friday.getMonth() + 1).padStart(2, "0");
  const d = String(friday.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** JPX から週次 Excel/CSV を取得し、Map<secCode, marginRatio> を返す */
async function loadJpxData(friday: string): Promise<Map<string, number | null>> {
  const base =
    "https://www.jpx.co.jp/markets/statistics-equities/margin/nlsgeu0000004yt7-att";
  const headers = {
    "User-Agent": UA,
    Referer: REFERER,
    Accept: "*/*",
    "Accept-Language": "ja-JP,ja;q=0.9",
  };

  // xlsx → csv の順で試みる
  for (const ext of ["xlsx", "csv"] as const) {
    try {
      const url = `${base}/data_${friday}.${ext}`;
      const res = await fetch(url, { headers });
      if (!res.ok) continue;

      if (ext === "csv") {
        const text = await res.text();
        return parseCSV(text);
      } else {
        const arrBuf = await res.arrayBuffer();
        return await parseXLSX(arrBuf);
      }
    } catch {
      // 次の拡張子で再試行
    }
  }

  return new Map();
}

/** CSV を解析して Map<secCode, marginRatio> を返す */
function parseCSV(text: string): Map<string, number | null> {
  const data = new Map<string, number | null>();
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let headerRow = -1;
  let codeCol = -1;
  let buyCol = -1;
  let sellCol = -1;
  let ratioCol = -1;

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cells = splitCsvRow(lines[i]);
    const ci = cells.findIndex((c) => c.includes("コード") || c === "Code");
    if (ci === -1) continue;

    headerRow = i;
    codeCol = ci;
    cells.forEach((c, j) => {
      if (c.includes("信用倍率")) ratioCol = j;
      if (/融資.*(当週|現在)/.test(c) || c === "当週末融資残") buyCol = j;
      if (/貸株.*(当週|現在)/.test(c) || c === "当週末貸株残") sellCol = j;
    });
    break;
  }

  if (headerRow === -1 || codeCol === -1) return data;

  for (let i = headerRow + 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    const code = cells[codeCol]?.trim().replace(/"/g, "");
    if (!code || !/^\d{4}$/.test(code)) continue;

    let ratio: number | null = null;
    if (ratioCol !== -1) {
      const raw = cells[ratioCol]?.replace(/"/g, "").trim();
      if (raw && raw !== "-") {
        const n = Number(raw.replace(/,/g, ""));
        if (!isNaN(n)) ratio = Math.round(n * 100) / 100;
      }
    } else if (buyCol !== -1 && sellCol !== -1) {
      const buy = Number(cells[buyCol]?.replace(/[",]/g, "") ?? "");
      const sell = Number(cells[sellCol]?.replace(/[",]/g, "") ?? "");
      if (!isNaN(buy) && !isNaN(sell) && sell > 0) {
        ratio = Math.round((buy / sell) * 100) / 100;
      }
    }

    data.set(code, ratio);
  }
  return data;
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { cells.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** XLSX を解析して Map<secCode, marginRatio> を返す */
async function parseXLSX(buffer: ArrayBuffer): Promise<Map<string, number | null>> {
  const data = new Map<string, number | null>();

  const workbook = new ExcelJS.Workbook();
  // ExcelJS の load() は Buffer を期待するが ArrayBuffer でも動作する
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];
  if (!ws) return data;

  let headerRow = -1;
  let codeCol = -1;
  let buyCol = -1;
  let sellCol = -1;
  let ratioCol = -1;

  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (headerRow !== -1) return;
    const vals = row.values as (unknown)[];
    for (let i = 1; i < vals.length; i++) {
      const v = String(vals[i] ?? "");
      if ((v.includes("コード") || v === "Code") && codeCol === -1) {
        headerRow = rn;
        codeCol = i;
      }
      if (v.includes("信用倍率")) ratioCol = i;
      if (/融資.*(当週|現在)/.test(v) || v === "当週末融資残") buyCol = i;
      if (/貸株.*(当週|現在)/.test(v) || v === "当週末貸株残") sellCol = i;
    }
  });

  if (headerRow === -1 || codeCol === -1) return data;

  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= headerRow) return;
    const vals = row.values as (unknown)[];
    const code = String(vals[codeCol] ?? "").trim();
    if (!/^\d{4}$/.test(code)) return;

    let ratio: number | null = null;
    if (ratioCol !== -1) {
      const v = vals[ratioCol];
      if (typeof v === "number") {
        ratio = Math.round(v * 100) / 100;
      } else if (typeof v === "string" && v !== "-") {
        const n = Number(v.replace(/,/g, ""));
        if (!isNaN(n)) ratio = Math.round(n * 100) / 100;
      }
    } else if (buyCol !== -1 && sellCol !== -1) {
      const buy = Number(String(vals[buyCol] ?? "").replace(/,/g, ""));
      const sell = Number(String(vals[sellCol] ?? "").replace(/,/g, ""));
      if (!isNaN(buy) && !isNaN(sell) && sell > 0) {
        ratio = Math.round((buy / sell) * 100) / 100;
      }
    }

    data.set(code, ratio);
  });

  return data;
}

/** 指定銘柄の信用倍率を返す。取得失敗時は null */
export async function fetchMarginRatio(secCode: string): Promise<number | null> {
  const friday = getLastFriday();

  if (marginCache?.friday === friday) {
    return marginCache.data.get(secCode) ?? null;
  }

  const data = await loadJpxData(friday);
  marginCache = { friday, data };

  return data.get(secCode) ?? null;
}
