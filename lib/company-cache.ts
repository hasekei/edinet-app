import { unstable_cache } from "next/cache";
import AdmZip from "adm-zip";
import iconv from "iconv-lite";

export interface CachedCompany {
  edinetCode: string;
  secCode: string;
  filerName: string;
}

const EDINET_CODE_LIST_URL =
  "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";

// EdinetcodeDlInfo.csv の列インデックス（ヘッダー2行の後、3行目がカラム名）
const COL_EDINET_CODE = 0;
const COL_FILER_NAME = 6;
const COL_SEC_CODE = 11;

// "a","b","c" 形式の1行を配列に分解する簡易CSVパーサー
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function buildCompanyList(): Promise<CachedCompany[]> {
  const res = await fetch(EDINET_CODE_LIST_URL, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];

  const arrayBuffer = await res.arrayBuffer();
  const zip = new AdmZip(Buffer.from(arrayBuffer));
  const entry = zip.getEntries().find((e) => e.entryName.endsWith(".csv"));
  if (!entry) return [];

  const text = iconv.decode(entry.getData(), "Shift_JIS");
  const lines = text.split(/\r\n|\n/);

  // 1行目: ダウンロード日時、2行目: カラム名、3行目以降: データ
  const companies: CachedCompany[] = [];
  const seen = new Set<string>();
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const edinetCode = cols[COL_EDINET_CODE];
    const filerName = cols[COL_FILER_NAME];
    if (!edinetCode || seen.has(edinetCode) || !filerName) continue;
    seen.add(edinetCode);
    companies.push({
      edinetCode,
      secCode: (cols[COL_SEC_CODE] ?? "").slice(0, 4),
      filerName,
    });
  }
  return companies;
}

// Next.js の unstable_cache でサーバー側に永続キャッシュ（24時間）
// Vercel のコールドスタートをまたいでも再ビルドしない
// v4: EDINETコードリストCSV（1回のダウンロードで全社を取得）に変更し、
//     90回のAPI並列呼び出しによる不安定さ（タイムアウトでの欠落）を解消
export const getCompanyList = unstable_cache(
  buildCompanyList,
  ["edinet-company-list-v4"],
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
