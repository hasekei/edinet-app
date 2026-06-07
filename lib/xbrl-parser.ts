import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { AccountingStandard, FinancialData } from "@/types/financial";

// JGAAP連結向けXBRLタグ（優先度順）
const JGAAP_TAGS = {
  netSales: [
    "NetSales",
    "NetSalesOfCompletedConstructionContracts",
    "OperatingRevenues",
    "Revenues",
  ],
  operatingIncome: ["OperatingIncome", "OperatingIncomeLoss"],
  ordinaryIncome: ["OrdinaryIncome"],
  netIncome: [
    "ProfitLoss",
    "ProfitLossAttributableToOwnersOfParent",
    "NetIncome",
    "NetIncomeLoss",
  ],
  eps: ["EarningsPerShare", "BasicEarningsPerShare", "NetIncomePerShare"],
  dps: [
    "AnnualDividendsPerShare",
    "DividendsPerShare",
    "DividendsPaidPerShare",
    "AnnualDividendPerShare",
  ],
};

// IFRS向けタグ
const IFRS_TAGS = {
  netSales: ["Revenue", "RevenueIFRSKeyFinancialData", "SalesRevenueIFRS"],
  operatingIncome: [
    "OperatingProfitLossIFRS",
    "ProfitLossFromOperatingActivitiesIFRS",
  ],
  ordinaryIncome: [],
  netIncome: [
    "ProfitLossAttributableToOwnersOfParentIFRS",
    "ProfitLossIFRS",
  ],
  eps: ["BasicEarningsLossPerShareIFRS", "BasicEarningsPerShareIFRS"],
  dps: ["DividendsPerShareIFRS", "DividendsPaidPerShareIFRS"],
};

// contextRef で連結/単体を判別するキーワード
const CONSOLIDATED_CONTEXTS = [
  "CurrentYearDuration_ConsolidatedMember",
  "CurrentYearDuration",
  "FilingDateInstant_ConsolidatedMember",
];
const NON_CONSOLIDATED_CONTEXTS = [
  "CurrentYearDuration_NonConsolidatedMember",
  "FilingDateInstant_NonConsolidatedMember",
];

export interface ParsedFinancials {
  netSales: number | null;
  operatingIncome: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  dps: number | null;
  isConsolidated: boolean;
  accountingStandard: AccountingStandard;
  periodEnd: string;
}

export function parseXbrlZip(zipBuffer: Buffer): ParsedFinancials {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // XBRLインスタンスファイルを探す（.xbrl or -ixbrl.htm）
  const xbrlEntry =
    entries.find(
      (e) =>
        !e.isDirectory &&
        (e.entryName.endsWith(".xbrl") ||
          e.entryName.match(/-ixbrl\.htm$/i)) &&
        !e.entryName.includes("manifest") &&
        !e.entryName.includes("label")
    ) ?? entries.find((e) => !e.isDirectory && e.entryName.endsWith(".xbrl"));

  if (!xbrlEntry) {
    throw new Error("XBRLファイルが見つかりません");
  }

  const content = xbrlEntry.getData().toString("utf-8");
  return extractFromXbrlContent(content);
}

function extractFromXbrlContent(content: string): ParsedFinancials {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(content);

  // 会計基準の判定
  const accountingStandard = detectAccountingStandard(content);
  const tagMap =
    accountingStandard === "IFRS" ? IFRS_TAGS : JGAAP_TAGS;

  // xbrli:xbrl or xbrl ルート要素を探す
  const root =
    parsed["xbrli:xbrl"] ??
    parsed["xbrl"] ??
    parsed["ix:xbrl"] ??
    Object.values(parsed)[0] ??
    {};

  // contextRef情報の収集
  const contexts = collectContexts(root);
  const isConsolidated = hasConsolidatedContext(contexts);

  // 財務データの抽出
  const flatElements = flattenXbrl(root);

  const periodEnd = extractPeriodEnd(contexts) ?? "";

  return {
    netSales: findValue(flatElements, tagMap.netSales, isConsolidated),
    operatingIncome: findValue(flatElements, tagMap.operatingIncome, isConsolidated),
    ordinaryIncome: findValue(flatElements, tagMap.ordinaryIncome, isConsolidated),
    netIncome: findValue(flatElements, tagMap.netIncome, isConsolidated),
    eps: findValue(flatElements, tagMap.eps, isConsolidated),
    dps: findValue(flatElements, tagMap.dps, isConsolidated),
    isConsolidated,
    accountingStandard,
    periodEnd,
  };
}

function detectAccountingStandard(content: string): AccountingStandard {
  if (content.includes("jpigp") || content.includes("IFRS")) return "IFRS";
  if (content.includes("jpus") || content.includes("US-GAAP")) return "US_GAAP";
  if (content.includes("jppfs") || content.includes("jpdei")) return "JGAAP";
  return "Unknown";
}

interface Context {
  id: string;
  startDate?: string;
  endDate?: string;
  instant?: string;
}

function collectContexts(root: Record<string, unknown>): Context[] {
  const contexts: Context[] = [];

  const visit = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;

    if ("@_id" in o && ("xbrli:period" in o || "period" in o)) {
      const period = (o["xbrli:period"] ?? o["period"]) as Record<string, unknown> | undefined;
      if (period) {
        contexts.push({
          id: String(o["@_id"]),
          startDate: String(period["xbrli:startDate"] ?? period["startDate"] ?? ""),
          endDate: String(period["xbrli:endDate"] ?? period["endDate"] ?? ""),
          instant: String(period["xbrli:instant"] ?? period["instant"] ?? ""),
        });
      }
    }

    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };

  visit(root);
  return contexts;
}

function hasConsolidatedContext(contexts: Context[]): boolean {
  return contexts.some((c) =>
    CONSOLIDATED_CONTEXTS.some((kw) => c.id.includes(kw))
  );
}

function extractPeriodEnd(contexts: Context[]): string | undefined {
  // 連結当期のコンテキストから期末日を取得
  const ctx = contexts.find((c) =>
    CONSOLIDATED_CONTEXTS.some((kw) => c.id.includes(kw))
  ) ?? contexts.find((c) =>
    NON_CONSOLIDATED_CONTEXTS.some((kw) => c.id.includes(kw))
  ) ?? contexts[0];

  return ctx?.endDate || ctx?.instant;
}

interface FlatElement {
  localName: string;
  value: number;
  contextRef: string;
}

function flattenXbrl(root: unknown): FlatElement[] {
  const elements: FlatElement[] = [];

  const visit = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;

    for (const [key, val] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text") continue;

      const localName = key.includes(":") ? key.split(":")[1] : key;

      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") {
            const itemObj = item as Record<string, unknown>;
            const numVal = extractNumericValue(itemObj);
            const contextRef = String(itemObj["@_contextRef"] ?? "");
            if (numVal !== null && contextRef) {
              elements.push({ localName, value: numVal, contextRef });
            }
            visit(item);
          }
        }
      } else if (val && typeof val === "object") {
        const numVal = extractNumericValue(val as Record<string, unknown>);
        const contextRef = String((val as Record<string, unknown>)["@_contextRef"] ?? "");
        if (numVal !== null && contextRef) {
          elements.push({ localName, value: numVal, contextRef });
        }
        visit(val);
      }
    }
  };

  visit(root);
  return elements;
}

function extractNumericValue(obj: Record<string, unknown>): number | null {
  const raw = obj["#text"] ?? obj["@_value"] ?? (typeof obj === "number" ? obj : null);
  if (raw === null || raw === undefined || raw === "") return null;
  const num = Number(String(raw).replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

function findValue(
  elements: FlatElement[],
  tagNames: string[],
  preferConsolidated: boolean
): number | null {
  const preferredKeywords = preferConsolidated
    ? CONSOLIDATED_CONTEXTS
    : NON_CONSOLIDATED_CONTEXTS;
  const fallbackKeywords = preferConsolidated
    ? NON_CONSOLIDATED_CONTEXTS
    : CONSOLIDATED_CONTEXTS;

  for (const tagName of tagNames) {
    // 優先コンテキストから探す
    const preferred = elements.find(
      (e) =>
        e.localName === tagName &&
        preferredKeywords.some((kw) => e.contextRef.includes(kw))
    );
    if (preferred) return preferred.value;

    // CurrentYearDurationのみ含むコンテキスト
    const duration = elements.find(
      (e) =>
        e.localName === tagName &&
        e.contextRef.includes("CurrentYearDuration")
    );
    if (duration) return duration.value;

    // フォールバック
    const fallback = elements.find(
      (e) =>
        e.localName === tagName &&
        fallbackKeywords.some((kw) => e.contextRef.includes(kw))
    );
    if (fallback) return fallback.value;

    // タグ名だけ一致する最初の要素
    const any = elements.find((e) => e.localName === tagName);
    if (any) return any.value;
  }

  return null;
}
