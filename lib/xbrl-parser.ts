import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { AccountingStandard, ForecastData } from "@/types/financial";

// ---- タグマッピング --------------------------------------------------------

const JGAAP_TAGS = {
  netSales: [
    // 一般製造業・商社
    "NetSales",
    "NetSalesOfCompletedConstructionContracts",
    "OperatingRevenues",
    "Revenues",
    "GrossSales",
    "NetRevenues",
    // 決算概要 (jpcrp_cor:NetSalesSummaryOfBusinessResults)
    "NetSalesSummaryOfBusinessResults",
    // 不動産業
    "NetSalesORRealEstate",
    // 銀行業の経常収益（売上高相当）
    "OrdinaryIncomeBNK",
    // 保険業の経常収益（売上高相当）
    "OperatingIncomeINS",
    // 電力・ガス・通信・鉄道・高速道路等の営業収益
    "OperatingRevenue1",
    "OperatingRevenue1SummaryOfBusinessResults",
    "OperatingRevenueCNA",
    "OperatingRevenueSEC",
    "OperatingRevenueRWY",
    "OperatingRevenueHighwayBusinessHWY",
    // US-GAAP決算概要
    "RevenuesUSGAAPSummaryOfBusinessResults",
  ],
  operatingIncome: [
    "OperatingIncome",
    "OperatingIncomeLoss",
    // US-GAAP決算概要
    "OperatingIncomeLossUSGAAPSummaryOfBusinessResults",
  ],
  ordinaryIncome: [
    "OrdinaryIncome",
    "OrdinaryIncomeLoss",
    // 決算概要
    "OrdinaryIncomeLossSummaryOfBusinessResults",
  ],
  netIncome: [
    "ProfitLoss",
    "ProfitLossAttributableToOwnersOfParent",
    "NetIncome",
    "NetIncomeLoss",
    "ProfitLossAttributableToOwnersOfParentInSummaryOfBusinessResults",
    // 決算概要 (jpcrp_cor)
    "NetIncomeLossSummaryOfBusinessResults",
    "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
  ],
  eps: [
    "EarningsPerShare",
    "BasicEarningsPerShare",
    "NetIncomePerShare",
    "EarningsPerShareBasic",
    "ProfitLossPerShare",
    "ProfitLossAttributableToOwnersOfParentPerShare",
    "BasicEarningsLossPerShare",
    "NetIncomeLossPerShare",
    // 決算概要
    "BasicEarningsLossPerShareSummaryOfBusinessResults",
  ],
  dps: [
    "AnnualDividendsPerShare",
    "DividendsPerShare",
    "DividendsPaidPerShare",
    "AnnualDividendPerShare",
    "DividendsPerShareOfCommonStock",
    "CashDividendsPerShare",
    "AnnualCashDividendsPerShare",
    "YearEndDividendsPerShare",
    "InterimDividendsPerShare",
    "DividendPerShare",
    // 決算概要
    "DividendPaidPerShareSummaryOfBusinessResults",
    "DividendPerShareDividendsOfSurplus",
  ],
};

const IFRS_TAGS = {
  netSales: [
    "Revenue",
    "RevenueIFRSKeyFinancialData",
    "SalesRevenueIFRS",
    "RevenueIFRS",
    "NetSalesIFRS",
    // 決算概要 (jpcrp_cor)
    "RevenueSummaryOfBusinessResults",
    "RevenueAndOtherIncomeIFRS",
  ],
  operatingIncome: [
    "OperatingProfitLossIFRS",
    "ProfitLossFromOperatingActivitiesIFRS",
    "OperatingIncomeIFRS",
  ],
  ordinaryIncome: [],
  netIncome: [
    "ProfitLossAttributableToOwnersOfParentIFRS",
    "ProfitLossIFRS",
    "NetIncomeIFRS",
    // 決算概要
    "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
  ],
  eps: [
    "BasicEarningsLossPerShareIFRS",
    "BasicEarningsPerShareIFRS",
    "EarningsLossPerShareIFRS",
    "EarningsPerShareIFRS",
    "BasicEarningsLossPerShare",
    "BasicEarningsPerShare",
    "EarningsPerShare",
    // 決算概要
    "BasicEarningsLossPerShareSummaryOfBusinessResults",
  ],
  dps: [
    "DividendsPerShareIFRS",
    "DividendsPaidPerShareIFRS",
    "AnnualDividendsPerShareIFRS",
    "CashDividendsPerShareIFRS",
    "DividendsPerShare",
    "AnnualDividendsPerShare",
    "DividendPerShareIFRS",
    // 決算概要
    "DividendPaidPerShareSummaryOfBusinessResults",
    "DividendPerShareDividendsOfSurplus",
  ],
};

// ---- 決算短信用タグ --------------------------------------------------------

const FORECAST_TAGS = {
  forecastOrdinaryIncome: [
    "ForecastOrdinaryIncome",
    "ForecastOrdinaryIncomeLoss",
    "ForecastOrdinaryIncomeSummaryOfBusinessResults",
    "ForecastOrdinaryIncomeLossSummaryOfBusinessResults",
    // IFRS・US-GAAP企業は経常利益なしのため営業利益で代替
    "ForecastOperatingIncome",
    "ForecastOperatingIncomeLoss",
    "ForecastOperatingIncomeSummaryOfBusinessResults",
  ],
  bps: [
    "BookValuePerShareSummaryOfBusinessResults",
    "NetAssetsPerShareSummaryOfBusinessResults",
    "BookValuePerShare",
    "NetAssetsPerShare",
  ],
  equityRatio: [
    "EquityToAssetRatioSummaryOfBusinessResults",
    "EquityRatioSummaryOfBusinessResults",
    "EquityToAssetRatio",
    "EquityRatio",
  ],
};

// 翌期予想コンテキスト（決算短信）
const FORECAST_CONTEXTS = [
  "Next1YearDuration_ConsolidatedMember",
  "Next1YearDuration_NonConsolidatedMember",
  "Next1YearDuration",
  "NextYearDuration_ConsolidatedMember",
  "NextYearDuration",
];

// 期末時点コンテキスト（BPS・自己資本比率はInstant）
const INSTANT_CONTEXTS = [
  "CurrentYearInstant_ConsolidatedMember",
  "CurrentYearInstant_NonConsolidatedMember",
  "CurrentYearInstant",
  "FilingDateInstant_ConsolidatedMember",
  "FilingDateInstant_NonConsolidatedMember",
  "FilingDateInstant",
];

// ---- コンテキスト --------------------------------------------------------

const CONSOLIDATED_CONTEXTS = [
  "CurrentYearDuration_ConsolidatedMember",
  "CurrentYearDuration",
  "FilingDateInstant_ConsolidatedMember",
];
const NON_CONSOLIDATED_CONTEXTS = [
  "CurrentYearDuration_NonConsolidatedMember",
  "FilingDateInstant_NonConsolidatedMember",
];

// ---- 型定義 ---------------------------------------------------------------

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

// ---- ZIP 解析 -------------------------------------------------------------

export function parseXbrlZip(zipBuffer: Buffer): ParsedFinancials {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // 除外パターン（リンクベース・マニフェスト）
  const isExcluded = (name: string) =>
    /manifest|_cal\.|_def\.|_lab\.|_pre\.|_ref\./i.test(name);

  // 1. 従来型 XBRL (.xbrl)
  const xbrlEntry =
    entries.find(
      (e) =>
        !e.isDirectory &&
        e.entryName.endsWith(".xbrl") &&
        !isExcluded(e.entryName)
    ) ??
    // 2. Inline XBRL: -ixbrl.htm
    entries.find(
      (e) =>
        !e.isDirectory &&
        e.entryName.match(/-ixbrl\.htm$/i) &&
        !isExcluded(e.entryName)
    ) ??
    // 3. Inline XBRL: PublicDoc ディレクトリ内の .htm ファイル（-ixbrl なし）
    entries.find(
      (e) =>
        !e.isDirectory &&
        /\.(htm|html|xhtml)$/i.test(e.entryName) &&
        /publicdoc/i.test(e.entryName) &&
        !isExcluded(e.entryName)
    ) ??
    // 4. 任意の .htm ファイル（最終フォールバック）
    entries.find(
      (e) =>
        !e.isDirectory &&
        /\.(htm|html|xhtml)$/i.test(e.entryName) &&
        !isExcluded(e.entryName)
    );

  if (!xbrlEntry) {
    throw new Error("XBRLファイルが見つかりません");
  }

  const content = xbrlEntry.getData().toString("utf-8");
  return extractFromXbrlContent(content);
}

// ---- XBRL コンテンツ解析 --------------------------------------------------

function extractFromXbrlContent(content: string): ParsedFinancials {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(content);

  const accountingStandard = detectAccountingStandard(content);
  const tagMap = accountingStandard === "IFRS" ? IFRS_TAGS : JGAAP_TAGS;

  const root =
    parsed["xbrli:xbrl"] ??
    parsed["xbrl"] ??
    parsed["ix:xbrl"] ??
    Object.values(parsed)[0] ??
    {};

  const contexts = collectContexts(root);
  const isConsolidated = hasConsolidatedContext(contexts);
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

// ---- 会計基準判定 ----------------------------------------------------------

function detectAccountingStandard(content: string): AccountingStandard {
  if (content.includes("jpigp") || content.includes("IFRS")) return "IFRS";
  if (content.includes("jpus") || content.includes("US-GAAP")) return "US_GAAP";
  if (content.includes("jppfs") || content.includes("jpdei")) return "JGAAP";
  return "Unknown";
}

// ---- コンテキスト収集 -------------------------------------------------------

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
  const ctx =
    contexts.find((c) =>
      CONSOLIDATED_CONTEXTS.some((kw) => c.id.includes(kw))
    ) ??
    contexts.find((c) =>
      NON_CONSOLIDATED_CONTEXTS.some((kw) => c.id.includes(kw))
    ) ??
    contexts[0];

  return ctx?.endDate || ctx?.instant;
}

// ---- 要素フラット化 (iXBRL 対応) -------------------------------------------

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

      const keyLocalName = key.includes(":") ? key.split(":")[1] : key;

      // ----- iXBRL の ix:nonFraction / ix:nonNumeric 処理 -----
      // name 属性に "jppfs_cor:EarningsPerShare" のような実タグ名が入る
      if (keyLocalName === "nonFraction" || keyLocalName === "nonNumeric") {
        const items = Array.isArray(val) ? val : [val];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const itemObj = item as Record<string, unknown>;
          const nameAttr = String(itemObj["@_name"] ?? "");
          if (nameAttr) {
            const ixLocalName = nameAttr.includes(":") ? nameAttr.split(":")[1] : nameAttr;
            let numVal = extractNumericValue(itemObj);
            if (numVal !== null) {
              // scale 属性: iXBRL では scale=6 なら × 10^6
              const scale = Number(itemObj["@_scale"] ?? 0);
              if (scale !== 0) numVal = numVal * Math.pow(10, scale);
              // sign="-" 属性: 値を負に反転（損失等）
              if (String(itemObj["@_sign"] ?? "") === "-") numVal = -numVal;
            }
            const contextRef = String(itemObj["@_contextRef"] ?? "");
            if (ixLocalName && numVal !== null && contextRef) {
              elements.push({ localName: ixLocalName, value: numVal, contextRef });
            }
          }
          visit(item);
        }
        continue; // 通常処理をスキップ
      }

      // ----- 通常の XBRL 要素 -----
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") {
            const itemObj = item as Record<string, unknown>;
            const numVal = extractNumericValue(itemObj);
            const contextRef = String(itemObj["@_contextRef"] ?? "");
            if (numVal !== null && contextRef) {
              elements.push({ localName: keyLocalName, value: numVal, contextRef });
            }
            visit(item);
          }
        }
      } else if (val && typeof val === "object") {
        const numVal = extractNumericValue(val as Record<string, unknown>);
        const contextRef = String((val as Record<string, unknown>)["@_contextRef"] ?? "");
        if (numVal !== null && contextRef) {
          elements.push({ localName: keyLocalName, value: numVal, contextRef });
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
  const str = String(raw).replace(/,/g, "").trim();
  if (!str) return null;
  const num = Number(str);
  return isNaN(num) ? null : num;
}

// ---- 値の検索 --------------------------------------------------------------

function findValueByContexts(
  elements: FlatElement[],
  tagNames: string[],
  preferContexts: string[],
  fallbackContexts: string[] = [],
): number | null {
  for (const tagName of tagNames) {
    const preferred = elements.find(
      (e) => e.localName === tagName && preferContexts.some((kw) => e.contextRef.includes(kw))
    );
    if (preferred) return preferred.value;
  }
  if (fallbackContexts.length > 0) {
    for (const tagName of tagNames) {
      const fallback = elements.find(
        (e) => e.localName === tagName && fallbackContexts.some((kw) => e.contextRef.includes(kw))
      );
      if (fallback) return fallback.value;
    }
  }
  // 最終フォールバック: タグ名一致のみ
  for (const tagName of tagNames) {
    const any = elements.find((e) => e.localName === tagName);
    if (any) return any.value;
  }
  return null;
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
    // 1. 優先コンテキスト
    const preferred = elements.find(
      (e) =>
        e.localName === tagName &&
        preferredKeywords.some((kw) => e.contextRef.includes(kw))
    );
    if (preferred) return preferred.value;

    // 2. CurrentYearDuration を含む任意のコンテキスト
    const duration = elements.find(
      (e) => e.localName === tagName && e.contextRef.includes("CurrentYearDuration")
    );
    if (duration) return duration.value;

    // 3. フォールバックコンテキスト
    const fallback = elements.find(
      (e) =>
        e.localName === tagName &&
        fallbackKeywords.some((kw) => e.contextRef.includes(kw))
    );
    if (fallback) return fallback.value;

    // 4. タグ名一致なら任意コンテキストで最初の要素
    const any = elements.find((e) => e.localName === tagName);
    if (any) return any.value;
  }

  return null;
}

// ---- 決算短信パーサー -------------------------------------------------------

export interface ParsedForecast {
  forecastOrdinaryIncome: number | null;
  bps: number | null;
  equityRatio: number | null;
}

export function parseForecastXbrl(zipBuffer: Buffer): ParsedForecast {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const isExcluded = (name: string) =>
    /manifest|_cal\.|_def\.|_lab\.|_pre\.|_ref\./i.test(name);

  const xbrlEntry =
    entries.find((e) => !e.isDirectory && e.entryName.endsWith(".xbrl") && !isExcluded(e.entryName)) ??
    entries.find((e) => !e.isDirectory && e.entryName.match(/-ixbrl\.htm$/i) && !isExcluded(e.entryName)) ??
    entries.find((e) => !e.isDirectory && /\.(htm|html|xhtml)$/i.test(e.entryName) && /publicdoc/i.test(e.entryName) && !isExcluded(e.entryName)) ??
    entries.find((e) => !e.isDirectory && /\.(htm|html|xhtml)$/i.test(e.entryName) && !isExcluded(e.entryName));

  if (!xbrlEntry) return { forecastOrdinaryIncome: null, bps: null, equityRatio: null };

  const content = xbrlEntry.getData().toString("utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(content);
  const root =
    parsed["xbrli:xbrl"] ?? parsed["xbrl"] ?? parsed["ix:xbrl"] ?? Object.values(parsed)[0] ?? {};

  const contexts = collectContexts(root as Record<string, unknown>);
  const isConsolidated = hasConsolidatedContext(contexts);
  const elements = flattenXbrl(root);

  // 予想経常利益: 翌期予想コンテキスト → 当期コンテキスト → 任意
  const forecastOrdinaryIncome = findValueByContexts(
    elements,
    FORECAST_TAGS.forecastOrdinaryIncome,
    isConsolidated
      ? FORECAST_CONTEXTS.filter((c) => c.includes("Consolidated"))
      : FORECAST_CONTEXTS.filter((c) => c.includes("NonConsolidated")),
    FORECAST_CONTEXTS,
  );

  // BPS・自己資本比率: 期末Instantコンテキスト優先
  const bps = findValueByContexts(
    elements,
    FORECAST_TAGS.bps,
    isConsolidated
      ? INSTANT_CONTEXTS.filter((c) => c.includes("Consolidated"))
      : INSTANT_CONTEXTS.filter((c) => c.includes("NonConsolidated")),
    INSTANT_CONTEXTS,
  );

  const equityRatio = findValueByContexts(
    elements,
    FORECAST_TAGS.equityRatio,
    isConsolidated
      ? INSTANT_CONTEXTS.filter((c) => c.includes("Consolidated"))
      : INSTANT_CONTEXTS.filter((c) => c.includes("NonConsolidated")),
    INSTANT_CONTEXTS,
  );

  return { forecastOrdinaryIncome, bps, equityRatio };
}
