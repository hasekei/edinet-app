import type { DocumentInfo } from "@/types/financial";
import puppeteer, { Browser } from "puppeteer";

const EDINET_BASE = "https://disclosure.edinet-fsa.go.jp/api/v2";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

function getApiKey(): string {
  const key = process.env.EDINET_API_KEY;
  if (!key) throw new Error("EDINET_API_KEY が設定されていません");
  return key;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

async function fetchJsonViaPage(url: string): Promise<any> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    let capturedJson: any = null;

    page.on("response", async (response) => {
      if (
        response.url().includes("documents.json") &&
        response.status() === 200
      ) {
        try {
          const text = await response.text();
          if (text.includes("results")) {
            capturedJson = JSON.parse(text);
          }
        } catch {
          // 解析エラーは無視
        }
      }
    });

    await page.goto(url, { waitUntil: "networkidle2" });

    if (capturedJson) {
      return capturedJson;
    }

    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText && bodyText.includes("results")) {
      try {
        return JSON.parse(bodyText);
      } catch {
        // JSON パース失敗
      }
    }

    throw new Error("JSON データが取得できませんでした");
  } finally {
    await page.close();
  }
}

export async function getDocumentList(date: string): Promise<DocumentInfo[]> {
  const apiKey = getApiKey();
  const url = `${EDINET_BASE}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;

  try {
    const json = await fetchJsonViaPage(url);
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
  const latestMonth = new Date(latest.submitDateTime).getMonth();

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

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(30000);

    const response = await page.goto(url, { waitUntil: "networkidle0" });

    if (!response || !response.ok()) {
      throw new Error(`ドキュメント取得エラー: ${response?.status()}`);
    }

    const buffer = await response.buffer();
    return buffer;
  } finally {
    await page.close();
  }
}
