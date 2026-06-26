import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { AccountingStandard } from "@/types/financial";

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

// ---- BPS・自己資本比率タグ（有報の「主要な経営指標等の推移」より実績値） --------
//
// 注意: IFRS提出企業のタクソノミでは、連結の「1株当たり純資産額」が
// "EquityToAssetRatioIFRSSummaryOfBusinessResults" タグに格納される
// (EDINETタクソノミ側の既知の名称不整合。実データで検証済み:
//  トヨタ/KDDIともに「連結純資産÷株式数」の実値と一致する一方、
//  本来の自己資本比率は別タグ"RatioOfOwnersEquityToGrossAssetsIFRS..."に入っている)
const PER_SHARE_TAGS = {
  bps: [
    "EquityToAssetRatioIFRSSummaryOfBusinessResults",
    "BookValuePerShareSummaryOfBusinessResults",
    "NetAssetsPerShareSummaryOfBusinessResults",
    "BookValuePerShare",
    "NetAssetsPerShare",
  ],
  equityRatio: [
    "RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults",
    "EquityToAssetRatioSummaryOfBusinessResults",
    "EquityRatioSummaryOfBusinessResults",
    "EquityToAssetRatio",
    "EquityRatio",
  ],
};

// 期末時点コンテキスト。連結企業はサフィックスなしの素のコンテキストを使用し、
// "_NonConsolidatedMember"（提出会社単体）の値と混在させない。
const CONSOLIDATED_INSTANT_CONTEXTS = ["CurrentYearInstant", "FilingDateInstant"];
const NON_CONSOLIDATED_INSTANT_CONTEXTS = [
  "CurrentYearInstant_NonConsolidatedMember",
  "FilingDateInstant_NonConsolidatedMember",
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
  bps: number | null;
  equityRatio: number | null;
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

  const bps = findPerShareValue(flatElements, PER_SHARE_TAGS.bps, isConsolidated);
  const equityRatio = findPerShareValue(flatElements, PER_SHARE_TAGS.equityRatio, isConsolidated);

  return {
    netSales: findValue(flatElements, tagMap.netSales, isConsolidated),
    operatingIncome: findValue(flatElements, tagMap.operatingIncome, isConsolidated),
    ordinaryIncome: findValue(flatElements, tagMap.ordinaryIncome, isConsolidated),
    netIncome: findValue(flatElements, tagMap.netIncome, isConsolidated),
    eps: findValue(flatElements, tagMap.eps, isConsolidated),
    dps: findValue(flatElements, tagMap.dps, isConsolidated),
    bps,
    equityRatio,
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

// BPS・自己資本比率専用。連結基準と単体基準の値を混在させないよう、
// contextRefの完全一致のみで判定する（部分一致だと
// "NonConsolidatedMember" が "Consolidated" にも誤マッチしてしまうため）。
function findPerShareValue(
  elements: FlatElement[],
  tagNames: string[],
  isConsolidated: boolean,
): number | null {
  const contexts = isConsolidated
    ? CONSOLIDATED_INSTANT_CONTEXTS
    : NON_CONSOLIDATED_INSTANT_CONTEXTS;

  for (const tagName of tagNames) {
    for (const ctx of contexts) {
      const match = elements.find((e) => e.localName === tagName && e.contextRef === ctx);
      if (match) return match.value;
    }
  }
  // 単体企業で単体コンテキストが見つからない場合のみ、素のコンテキストにフォールバック
  if (!isConsolidated) {
    for (const tagName of tagNames) {
      for (const ctx of CONSOLIDATED_INSTANT_CONTEXTS) {
        const match = elements.find((e) => e.localName === tagName && e.contextRef === ctx);
        if (match) return match.value;
      }
    }
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

