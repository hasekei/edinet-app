import type { ForecastData } from "@/types/financial";

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
 * 理論株価を計算する。
 *
 * 計算用EPS = 予想経常利益 × 0.7 ÷ 発行済株式数
 * 発行済株式数 = netIncome ÷ eps（実績から推計）
 *
 * ROA = 計算用EPS ÷ (BPS ÷ 自己資本比率)
 * 事業価値 = 計算用EPS × 15 × ROA × 10 × 財務レバレッジ補正
 * 資産価値 = BPS × 割引評価率
 * 理論株価 = 事業価値 + 資産価値
 */
export function calcTheoreticalPrice(
  forecast: ForecastData,
  netIncome: number | null,
  eps: number | null,
): number | null {
  const { forecastOrdinaryIncome, bps, equityRatio } = forecast;

  if (forecastOrdinaryIncome == null || bps == null || equityRatio == null) return null;
  if (!netIncome || !eps || eps === 0) return null;
  if (bps <= 0) return null;

  // 発行済株式数を実績EPS・純利益から推計
  const shares = netIncome / eps;
  if (shares <= 0) return null;

  // 自己資本比率をパーセント表記に正規化（XBRL で小数（0.35）またはパーセント（35）で格納される）
  const equityRatioPct = equityRatio <= 1 ? equityRatio * 100 : equityRatio;
  if (equityRatioPct <= 0) return null;

  const calcEps = (forecastOrdinaryIncome * 0.7) / shares;

  // ROA = 計算用EPS ÷ (BPS ÷ 自己資本比率[decimal])
  const equityRatioDecimal = equityRatioPct / 100;
  const roa = calcEps / (bps / equityRatioDecimal);

  const leverage = getLeverage(equityRatioPct);
  const discount = getDiscountRate(equityRatioPct);

  const businessValue = calcEps * 15 * roa * 10 * leverage;
  const assetValue = bps * discount;

  const result = businessValue + assetValue;
  if (!isFinite(result) || result < 0) return null;

  return Math.round(result);
}
