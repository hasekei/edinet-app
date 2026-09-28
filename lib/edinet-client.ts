import type { DocumentInfo } from "@/types/financial";

const EDINET_BASE = "https://api.edinet-fsa.go.jp/api/v2";

function getApiKey(): string {
  const key = process.env.EDINET_API_KEY;
  if (!key) throw new Error("EDINET_API_KEY が設定されていません");
  return key;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// EDINET APIへの全リクエストをこのキューで一定間隔にペーシングする。
// Promise.all で複数リクエストを「並列」に発行すると見かけ上は速いが、
// 実際のfetch送信が同時に殺到してレート制限(429)を誘発しやすい。
// ここで全リクエストを直列化し、最低間隔を空けて送出することで
// 複数年・一括取得（同時に大量の日付を問い合わせる）でのレート制限の
// 多発と、それに伴う書類の静かな欠落を防ぐ。
const REQUEST_INTERVAL_MS = 120;
let requestQueue: Promise<void> = Promise.resolve();

function throttledFetch(url: string): Promise<Response> {
  const scheduled = requestQueue.then(() => sleep(REQUEST_INTERVAL_MS));
  requestQueue = scheduled;
  return scheduled.then(() => fetch(url, { headers: { Accept: "application/json" } }));
}

// EDINET APIはレート制限(429)時もHTTPステータス自体は200を返し、
// レスポンス本文の status/StatusCode でのみエラーを通知してくる。
// res.ok だけを見ていると 429 を検知できず、その日は「該当書類なし」として
// 静かに握りつぶされ、複数年・一括取得で年度が丸ごと欠落する原因になっていた。
async function fetchJson(url: string, retries = 5): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await throttledFetch(url);

    if (!res.ok) {
      throw new Error(`EDINET API エラー: HTTP ${res.status}`);
    }

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("EDINET API から JSON 以外のレスポンスが返されました");
    }

    const status = json?.metadata?.status ?? json?.StatusCode;
    if (status !== undefined && String(status) !== "200") {
      if (String(status) === "429" && attempt < retries) {
        await sleep(500 * (attempt + 1) + Math.random() * 300);
        continue;
      }
      throw new Error(`EDINET API エラー(${status}): ${json?.message ?? "不明なエラー"}`);
    }

    return json;
  }

  throw new Error("EDINET API リクエストがレート制限により失敗しました");
}

// 日付ごとの書類一覧は「その日に提出された全書類」であり証券コードに依存しない。
// 一括取得（複数銘柄）や複数年取得では、直近400日分の探索範囲が銘柄間・年度間で
// 大きく重複するため、同じ日付への問い合わせをキャッシュ（進行中のリクエストも
// 共有）することでAPI呼び出し数を大幅に削減し、レート制限の発生自体を防ぐ。
const documentListCache = new Map<string, Promise<DocumentInfo[]>>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function getDocumentList(date: string): Promise<DocumentInfo[]> {
  const cached = documentListCache.get(date);
  if (cached) return cached;

  const promise = (async () => {
    const apiKey = getApiKey();
    const url = `${EDINET_BASE}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;
    try {
      const json = await fetchJson(url);
      return (json.results ?? []) as DocumentInfo[];
    } catch (err) {
      console.error(`[EDINET] getDocumentList エラー (date=${date}):`, err);
      documentListCache.delete(date);
      return [];
    }
  })();

  documentListCache.set(date, promise);
  setTimeout(() => documentListCache.delete(date), CACHE_TTL_MS).unref?.();
  return promise;
}

export async function findDocumentsBySecCode(
  secCode: string,
  docTypeCode = "120",
  daysBack = 400
): Promise<DocumentInfo[]> {
  const paddedSecCode = secCode.toUpperCase().padEnd(5, "0");
  const today = new Date();
  const results: DocumentInfo[] = [];
  const batchSize = 15;
  let found = false;

  for (let i = 0; i < daysBack && !found; i += batchSize) {
    const batchPromises: Promise<DocumentInfo[]>[] = [];
    for (let j = i; j < Math.min(i + batchSize, daysBack); j++) {
      const date = new Date(today);
      date.setDate(today.getDate() - j);
      const dateStr = formatDate(date);

      batchPromises.push(
        (async () => {
          const json = await getDocumentList(dateStr);
          return json.filter(
            (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
          );
        })()
      );
    }

    const batchResults = await Promise.all(batchPromises);
    for (const docs of batchResults) {
      results.push(...docs);
      if (docs.length > 0) found = true;
    }

    if (found) break;
  }

  return results.sort(
    (a, b) =>
      new Date(b.submitDateTime).getTime() -
      new Date(a.submitDateTime).getTime()
  );
}

export async function findDocumentsByYearRange(
  secCode: string,
  fromYear: number,
  toYear: number,
  docTypeCode = "120"
): Promise<DocumentInfo[]> {
  const paddedSecCode = secCode.toUpperCase().padEnd(5, "0");

  const latestDocs = await findDocumentsBySecCode(secCode, docTypeCode, 400);
  if (latestDocs.length === 0) return [];

  const latest = latestDocs[0];
  // 12月決算企業などは決算期（periodEnd）の翌年に提出されるため、
  // 「提出日の年」を基準に年度オフセットを計算すると1年ずれる。
  // 提出日と決算期年の差を latestDocs から求め、その差を各年度に適用する。
  const latestSubmitYear = new Date(latest.submitDateTime).getFullYear();
  const latestPeriodEndYear = latest.periodEnd
    ? parseInt(latest.periodEnd.slice(0, 4), 10)
    : latestSubmitYear;

  const allDocs: DocumentInfo[] = [...latestDocs];
  const seenDocIds = new Set<string>(latestDocs.map((d) => d.docID));

  const foundYears = new Set<number>();
  for (const d of latestDocs) {
    const y = parseInt((d.periodEnd ?? "0").slice(0, 4), 10);
    if (y >= fromYear && y <= toYear) foundYears.add(y);
  }

  const allYears: number[] = [];
  for (let y = fromYear; y <= toYear; y++) allYears.push(y);

  // 株主総会の日程は年によって数日ずれるため、提出想定日（前年同時期）ぴったり
  // だけを見ると年度が丸ごと欠落する。かといって毎年±45日を全部1日刻みで
  // 探索すると年数分のAPIコールが膨大になりレート制限・タイムアウトを招くため、
  // まず狭い範囲を探索し、見つからなかった年度だけ段階的に範囲を広げる。
  const stageBoundaries = [-1, 7, 20, 45];
  for (let s = 1; s < stageBoundaries.length; s++) {
    const prevBound = stageBoundaries[s - 1];
    const bound = stageBoundaries[s];

    const pendingYears = allYears.filter((y) => !foundYears.has(y));
    if (pendingYears.length === 0) break;

    const datesToCheck = new Set<string>();
    for (const targetYear of pendingYears) {
      const yearOffset = latestPeriodEndYear - targetYear;
      const centerDate = new Date(latest.submitDateTime);
      centerDate.setFullYear(centerDate.getFullYear() - yearOffset);

      for (let offset = -bound; offset <= bound; offset++) {
        if (Math.abs(offset) <= prevBound) continue;
        const d = new Date(centerDate);
        d.setDate(d.getDate() + offset);
        datesToCheck.add(formatDate(d));
      }
    }

    const dateList = [...datesToCheck];
    const batchSize = 15;
    for (let i = 0; i < dateList.length; i += batchSize) {
      const batch = dateList.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (dateStr) => {
          const json = await getDocumentList(dateStr);
          return json.filter(
            (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
          );
        })
      );

      for (const docs of results) {
        for (const doc of docs) {
          if (!seenDocIds.has(doc.docID)) {
            seenDocIds.add(doc.docID);
            allDocs.push(doc);
            const y = parseInt((doc.periodEnd ?? "0").slice(0, 4), 10);
            if (y >= fromYear && y <= toYear) foundYears.add(y);
          }
        }
      }
    }
  }

  return allDocs
    .filter((d) => {
      const y = parseInt((d.periodEnd ?? "0").slice(0, 4), 10);
      return y >= fromYear && y <= toYear;
    })
    .sort(
      (a, b) =>
        new Date(b.periodEnd ?? "").getTime() -
        new Date(a.periodEnd ?? "").getTime()
    )
    .filter((d, idx, arr) => arr.findIndex((x) => x.docID === d.docID) === idx);
}

export async function downloadDocumentZip(docID: string): Promise<Buffer> {
  const apiKey = getApiKey();
  const url = `${EDINET_BASE}/documents/${docID}?type=1&Subscription-Key=${apiKey}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`ドキュメント取得エラー: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
