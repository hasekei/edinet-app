import type { DocumentInfo } from "@/types/financial";

const EDINET_BASE = "https://disclosure.edinet-fsa.go.jp/api/v2";

function getApiKey(): string {
  const key = process.env.EDINET_API_KEY;
  if (!key) throw new Error("EDINET_API_KEY が設定されていません");
  return key;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export async function getDocumentList(date: string): Promise<DocumentInfo[]> {
  const apiKey = getApiKey();
  const url = `${EDINET_BASE}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`EDINET API エラー: ${res.status}`);
  const json = await res.json();
  return (json.results ?? []) as DocumentInfo[];
}

// 直近N日分を証券コードで絞り込む（最初の1件発見で停止）
export async function findDocumentsBySecCode(
  secCode: string,
  docTypeCode = "120",
  daysBack = 400
): Promise<DocumentInfo[]> {
  const apiKey = getApiKey();
  const paddedSecCode = secCode.padEnd(5, "0");

  const today = new Date();
  const results: DocumentInfo[] = [];
  const batchSize = 30;
  let found = false;

  for (let i = 0; i < daysBack && !found; i += batchSize) {
    const batchPromises: Promise<DocumentInfo[]>[] = [];
    for (let j = i; j < Math.min(i + batchSize, daysBack); j++) {
      const date = new Date(today);
      date.setDate(today.getDate() - j);
      const dateStr = formatDate(date);
      const url = `${EDINET_BASE}/documents.json?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
      batchPromises.push(
        fetch(url, { next: { revalidate: 86400 } })
          .then((r) => (r.ok ? r.json() : { results: [] }))
          .then((json) =>
            ((json.results ?? []) as DocumentInfo[]).filter(
              (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
            )
          )
          .catch(() => [])
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

// 年度範囲指定で複数の有価証券報告書を取得
// 戦略: 最新1件を取得→提出月のパターンを特定→各年の提出月前後を集中検索
export async function findDocumentsByYearRange(
  secCode: string,
  fromYear: number,
  toYear: number,
  docTypeCode = "120"
): Promise<DocumentInfo[]> {
  const apiKey = getApiKey();
  const paddedSecCode = secCode.padEnd(5, "0");

  // まず最新1件で提出月パターンを把握
  const latestDocs = await findDocumentsBySecCode(secCode, docTypeCode, 400);
  if (latestDocs.length === 0) return [];

  const latest = latestDocs[0];
  const latestYear = new Date(latest.submitDateTime).getFullYear();
  const latestMonth = new Date(latest.submitDateTime).getMonth(); // 0-indexed

  const allDocs: DocumentInfo[] = [...latestDocs];
  const foundYears = new Set<string>([
    (latest.periodEnd ?? "").slice(0, 4),
  ]);

  // 各年について提出月前後±45日を検索
  const yearsToSearch: number[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    yearsToSearch.push(y);
  }

  await Promise.all(
    yearsToSearch.map(async (targetYear) => {
      // latestMonth のパターンを各年に適用（例: 6月提出なら各年6月前後を検索）
      const yearOffset = latestYear - targetYear;
      const centerDate = new Date(latest.submitDateTime);
      centerDate.setFullYear(centerDate.getFullYear() - yearOffset);

      // 中心日±45日の範囲を5日ごとにサンプリング
      const datesToCheck: string[] = [];
      for (let offset = -45; offset <= 45; offset += 5) {
        const d = new Date(centerDate);
        d.setDate(d.getDate() + offset);
        datesToCheck.push(formatDate(d));
      }

      const results = await Promise.all(
        datesToCheck.map((dateStr) => {
          const url = `${EDINET_BASE}/documents.json?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
          return fetch(url, { next: { revalidate: 86400 } })
            .then((r) => (r.ok ? r.json() : { results: [] }))
            .then((json) =>
              ((json.results ?? []) as DocumentInfo[]).filter(
                (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
              )
            )
            .catch(() => []);
        })
      );

      for (const docs of results) {
        for (const doc of docs) {
          const periodYear = (doc.periodEnd ?? "").slice(0, 4);
          if (!foundYears.has(doc.docID)) {
            foundYears.add(doc.docID);
            allDocs.push(doc);
          }
        }
      }
    })
  );

  // periodEnd の年でフィルタして降順ソート
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
    .filter((d, idx, arr) => arr.findIndex((x) => x.docID === d.docID) === idx); // 重複除去
}

export async function downloadDocumentZip(docID: string): Promise<Buffer> {
  const apiKey = getApiKey();
  const url = `${EDINET_BASE}/documents/${docID}?type=1&Subscription-Key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ドキュメント取得エラー: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
