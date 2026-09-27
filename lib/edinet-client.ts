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

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`EDINET API エラー: HTTP ${res.status}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("EDINET API から JSON 以外のレスポンスが返されました");
  }
}

export async function getDocumentList(date: string): Promise<DocumentInfo[]> {
  const apiKey = getApiKey();
  const url = `${EDINET_BASE}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;

  try {
    const json = await fetchJson(url);
    return (json.results ?? []) as DocumentInfo[];
  } catch (err) {
    console.error(`[EDINET] getDocumentList エラー:`, err);
    return [];
  }
}

export async function findDocumentsBySecCode(
  secCode: string,
  docTypeCode = "120",
  daysBack = 400
): Promise<DocumentInfo[]> {
  const paddedSecCode = secCode.toUpperCase().padEnd(5, "0");
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

      batchPromises.push(
        (async () => {
          try {
            const json = await getDocumentList(dateStr);
            return json.filter(
              (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
            );
          } catch {
            return [];
          }
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
  const latestYear = new Date(latest.submitDateTime).getFullYear();

  const allDocs: DocumentInfo[] = [...latestDocs];
  const seenDocIds = new Set<string>(latestDocs.map((d) => d.docID));

  const yearsToSearch: number[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    yearsToSearch.push(y);
  }

  await Promise.all(
    yearsToSearch.map(async (targetYear) => {
      const yearOffset = latestYear - targetYear;
      const centerDate = new Date(latest.submitDateTime);
      centerDate.setFullYear(centerDate.getFullYear() - yearOffset);

      const datesToCheck: string[] = [];
      for (let offset = -45; offset <= 45; offset += 5) {
        const d = new Date(centerDate);
        d.setDate(d.getDate() + offset);
        datesToCheck.push(formatDate(d));
      }

      const results = await Promise.all(
        datesToCheck.map(async (dateStr) => {
          try {
            const json = await getDocumentList(dateStr);
            return json.filter(
              (d) => d.secCode === paddedSecCode && d.docTypeCode === docTypeCode
            );
          } catch {
            return [];
          }
        })
      );

      for (const docs of results) {
        for (const doc of docs) {
          if (!seenDocIds.has(doc.docID)) {
            seenDocIds.add(doc.docID);
            allDocs.push(doc);
          }
        }
      }
    })
  );

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
