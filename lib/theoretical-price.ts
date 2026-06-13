import type { ForecastData } from "@/types/financial";

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
 *
 * 計算用EPS = 予想経常利益 × 0.7 ÷ 発行済株式数（推計）
 * ROA       = 計算用EPS ÷ (BPS ÷ 自己資本比率)
 * 事業価値  = 計算用EPS × 15 × ROA × 10 × 財務レバレッジ補正
 * 資産価値  = BPS × 割引評価率
 * 理論株価  = 事業価値 + 資産価値
 */
export function calcTheoreticalPrice(
  forecast: ForecastData,
  netIncome: number | null,
  eps: number | null,
): TheoreticalPriceResult {
  const { forecastOrdinaryIncome, bps, equityRatio } = forecast;

  if (forecastOrdinaryIncome == null || bps == null || equityRatio == null) return NULL_RESULT;
  if (!netIncome || !eps || eps === 0) return NULL_RESULT;
  if (bps <= 0) return NULL_RESULT;

  const sharesEstimate = netIncome / eps;
  if (sharesEstimate <= 0) return NULL_RESULT;

  const equityRatioPct = equityRatio <= 1 ? equityRatio * 100 : equityRatio;
  if (equityRatioPct <= 0) return NULL_RESULT;

  const calcEps = (forecastOrdinaryIncome * 0.7) / sharesEstimate;
  const equityRatioDecimal = equityRatioPct / 100;
  const roa = calcEps / (bps / equityRatioDecimal);
  const leverage = getLeverage(equityRatioPct);
  const discountRate = getDiscountRate(equityRatioPct);
  const businessValue = calcEps * 15 * roa * 10 * leverage;
  const assetValue = bps * discountRate;
  const total = businessValue + assetValue;

  if (!isFinite(total) || total < 0) return NULL_RESULT;

  return {
    price: Math.round(total),
    sharesEstimate: Math.round(sharesEstimate),
    calcEps: Math.round(calcEps * 100) / 100,
    equityRatioPct: Math.round(equityRatioPct * 10) / 10,
    roa: Math.round(roa * 10000) / 10000,
    leverage,
    discountRate,
    businessValue: Math.round(businessValue),
    assetValue: Math.round(assetValue),
  };
}
