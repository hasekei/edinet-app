import type { FinancialData } from "@/types/financial";

export interface TheoreticalPriceResult {
  price: number | null;
  sharesEstimate: number | null;
  calcEps: number | null;
  equityRatioPct: number | null;
  roa: number | null;
  leverage: number | null;
  discountRate: number | null;
  businessValue: number | null;
  assetValue: number | null;
}

const NULL_RESULT: TheoreticalPriceResult = {
  price: null, sharesEstimate: null, calcEps: null,
  equityRatioPct: null, roa: null, leverage: null,
  discountRate: null, businessValue: null, assetValue: null,
};

function getLeverage(pct: number): number {
  if (pct >= 66.7) return 1;
  if (pct >= 33.4) return 1.25;
  return 1.5;
}

function getDiscountRate(pct: number): number {
  if (pct >= 80) return 0.8;
  if (pct >= 67) return 0.75;
  if (pct >= 50) return 0.7;
  if (pct >= 33) return 0.65;
  if (pct >= 10) return 0.6;
  return 0.5;
}

/**
 * 理論株価を計算し、全中間値を返す。
 * 決算短信の予想経常利益はEDINETでは取得不可能なため、
 * 有報の実績経常利益で代用する（参考値）。
 *
 * 計算用EPS = 経常利益（実績） × 0.7 ÷ 発行済株式数（推計）
 * ROA       = 計算用EPS ÷ (BPS ÷ 自己資本比率)
 * 事業価値  = 計算用EPS × 15 × ROA × 10 × 財務レバレッジ補正
 * 資産価値  = BPS × 割引評価率
 * 理論株価  = 事業価値 + 資産価値
 *
 * 経常利益・純利益・EPSのいずれかが取得できない場合でも、それらに依存しない
 * 項目は引き続き算出して返す（全項目を一律nullにはしない）。
 * - 自己資本比率・財務レバレッジ補正・割引評価率・資産価値: BPS・自己資本比率のみで算出可能
 * - 発行済株式数（推計）: 純利益・EPSが必要
 * - 計算用EPS・ROA・事業価値・理論株価: 上記に加えて経常利益が必要
 */
export function calcTheoreticalPrice(fin: FinancialData): TheoreticalPriceResult {
  const { ordinaryIncome, bps, equityRatio, netIncome, eps } = fin;

  if (bps == null || equityRatio == null || bps <= 0) return NULL_RESULT;

  const equityRatioPct = equityRatio <= 1 ? equityRatio * 100 : equityRatio;
  if (equityRatioPct <= 0) return NULL_RESULT;

  const leverage = getLeverage(equityRatioPct);
  const discountRate = getDiscountRate(equityRatioPct);
  const assetValue = bps * discountRate;

  let sharesEstimate: number | null = null;
  let calcEps: number | null = null;
  let roa: number | null = null;
  let businessValue: number | null = null;

  if (netIncome && eps) {
    const rawSharesEstimate = netIncome / eps;
    if (rawSharesEstimate > 0) {
      sharesEstimate = Math.round(rawSharesEstimate);

      if (ordinaryIncome != null) {
        const equityRatioDecimal = equityRatioPct / 100;
        const rawCalcEps = (ordinaryIncome * 0.7) / rawSharesEstimate;
        const rawRoa = rawCalcEps / (bps / equityRatioDecimal);
        const rawBusinessValue = rawCalcEps * 15 * rawRoa * 10 * leverage;
        if (isFinite(rawBusinessValue)) {
          calcEps = Math.round(rawCalcEps * 100) / 100;
          roa = Math.round(rawRoa * 10000) / 10000;
          businessValue = Math.round(rawBusinessValue);
        }
      }
    }
  }

  const total = businessValue != null ? businessValue + assetValue : null;
  const price = total != null && isFinite(total) && total >= 0 ? Math.round(total) : null;

  return {
    price,
    sharesEstimate,
    calcEps,
    equityRatioPct: Math.round(equityRatioPct * 10) / 10,
    roa,
    leverage,
    discountRate,
    businessValue,
    assetValue: Math.round(assetValue),
  };
}
