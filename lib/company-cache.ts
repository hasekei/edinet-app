import type { DocumentInfo } from "@/types/financial";

export interface CachedCompany {
  edinetCode: string;
  secCode: string;
  filerName: string;
}

interface Cache {
  companies: CachedCompany[];
  builtAt: number;
  building: boolean;
}

// Module-level cache (dev serverでは永続、Vercelでは関数がウォームな間保持)
const state: Cache = { companies: [], builtAt: 0, building: false };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間

async function fetchDocumentList(date: string): Promise<DocumentInfo[]> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://disclosure.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.results ?? []) as DocumentInfo[];
  } catch {
    return [];
  }
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function buildCache(): Promise<void> {
  if (state.building) return;
  if (state.builtAt && Date.now() - state.builtAt < CACHE_TTL) return;

  state.building = true;

  const today = new Date();
  // 過去14日分の日付を生成
  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(dateStr(d));
  }

  const seen = new Set<string>();
  const companies: CachedCompany[] = [];

  // 5日ずつ並列フェッチ
  for (let i = 0; i < dates.length; i += 5) {
    const batch = dates.slice(i, i + 5);
    const results = await Promise.all(batch.map(fetchDocumentList));
    for (const docs of results) {
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
  }

  state.companies = companies;
  state.builtAt = Date.now();
  state.building = false;
}

export function searchCache(query: string): CachedCompany[] {
  if (!query) return [];
  const q = query.toLowerCase();
  return state.companies
    .filter(
      (c) =>
        c.filerName.toLowerCase().includes(q) ||
        (c.secCode && c.secCode.startsWith(q))
    )
    .slice(0, 15);
}

export function cacheStats() {
  return {
    count: state.companies.length,
    building: state.building,
    ready: state.builtAt > 0,
  };
}
