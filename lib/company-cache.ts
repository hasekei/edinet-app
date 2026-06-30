import { unstable_cache } from "next/cache";
import type { DocumentInfo } from "@/types/financial";

export interface CachedCompany {
  edinetCode: string;
  secCode: string;
  filerName: string;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function buildCompanyList(): Promise<CachedCompany[]> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return [];

  const today = new Date();
  const dates: string[] = [];
  // 四半期提出サイクル (90日) をカバーして主要上場企業をすべて収録
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(dateStr(d));
  }

  // 全日付を並列フェッチ（個別に3秒タイムアウト）
  const allDocs = await Promise.all(
    dates.map(async (date) => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3000);
        const url = `https://disclosure.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;
        const res = await fetch(url, {
          signal: controller.signal,
          next: { revalidate: 86400 },
        });
        clearTimeout(tid);
        if (!res.ok) return [] as DocumentInfo[];
        const json = await res.json();
        return (json.results ?? []) as DocumentInfo[];
      } catch {
        return [] as DocumentInfo[];
      }
    })
  );

  const seen = new Set<string>();
  const companies: CachedCompany[] = [];
  for (const docs of allDocs) {
    for (const d of docs) {
      if (!d.edinetCode || seen.has(d.edinetCode)) continue;
      seen.add(d.edinetCode);
      if (d.filerName) {
        companies.push({
          edinetCode: d.edinetCode,
          secCode: (d.secCode ?? "").slice(0, 4),
          filerName: d.filerName,
        });
      }
    }
  }
  return companies;
}

// Next.js の unstable_cache でサーバー側に永続キャッシュ（6時間）
// Vercel のコールドスタートをまたいでも再ビルドしない
export const getCompanyList = unstable_cache(
  buildCompanyList,
  ["edinet-company-list-v3"],
  { revalidate: 24 * 60 * 60 }
);

export function searchCompanies(
  companies: CachedCompany[],
  query: string
): CachedCompany[] {
  if (!query) return [];
  const q = query.toLowerCase();
  return companies
    .filter(
      (c) =>
        c.filerName.toLowerCase().includes(q) ||
        (c.secCode && c.secCode.toLowerCase().startsWith(q))
    )
    .slice(0, 15);
}
