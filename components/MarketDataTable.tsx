"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MarketData, FinancialData } from "@/types/financial";

interface Props {
  companies: Array<{ secCode: string; companyName?: string }>;
  marketData: Record<string, MarketData>;
  latestFinancials: Record<string, FinancialData>;
}

function Val({
  value,
  decimals = 1,
  suffix = "",
  loading = false,
}: {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  loading?: boolean;
}) {
  if (loading)
    return <span className="text-muted-foreground text-xs">取得中…</span>;
  if (value == null)
    return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {value.toLocaleString("ja-JP", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </>
  );
}

function ratio(currentPrice: number | null, perShare: number | null | undefined, kind: "per" | "pbr" | "yield") {
  if (!currentPrice || currentPrice <= 0 || perShare == null) return null;
  if (kind === "yield") {
    if (perShare < 0) return null;
    return Math.round((perShare / currentPrice) * 10000) / 100;
  }
  if (perShare <= 0) return null;
  return kind === "per"
    ? Math.round((currentPrice / perShare) * 10) / 10
    : Math.round((currentPrice / perShare) * 100) / 100;
}

function calcMetrics(
  currentPrice: number | null,
  fin: FinancialData | undefined,
  market: MarketData | undefined,
) {
  return {
    per: ratio(currentPrice, fin?.eps, "per"),
    pbr: ratio(currentPrice, fin?.bps, "pbr"),
    dividendYield: ratio(currentPrice, fin?.dps, "yield"),
    yahooPer: ratio(currentPrice, market?.yahooEps, "per"),
    yahooPbr: ratio(currentPrice, market?.yahooBps, "pbr"),
    yahooDividendYield: ratio(currentPrice, market?.yahooDps, "yield"),
  };
}

function RefNote({ value, decimals, suffix }: { value: number | null; decimals: number; suffix: string }) {
  if (value == null) return null;
  return (
    <div className="text-[10px] text-muted-foreground font-normal">
      Yahoo参考 {value.toLocaleString("ja-JP", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </div>
  );
}

export default function MarketDataTable({ companies, marketData, latestFinancials }: Props) {
  if (companies.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold whitespace-nowrap">証券コード</TableHead>
            <TableHead className="font-semibold">会社名</TableHead>
            <TableHead className="font-semibold">業種</TableHead>
            <TableHead className="text-right font-semibold whitespace-nowrap bg-amber-100/60 dark:bg-amber-800/40">
              株価（円）
            </TableHead>
            <TableHead className="text-right font-semibold whitespace-nowrap bg-orange-100/60 dark:bg-orange-800/40">
              PER
            </TableHead>
            <TableHead className="text-right font-semibold whitespace-nowrap bg-rose-100/60 dark:bg-rose-800/40">
              PBR
            </TableHead>
            <TableHead className="text-right font-semibold whitespace-nowrap bg-teal-100/60 dark:bg-teal-800/40">
              配当利回り
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map(({ secCode, companyName }) => {
            const d = marketData[secCode];
            const loading = !d;
            const { per, pbr, dividendYield, yahooPer, yahooPbr, yahooDividendYield } = calcMetrics(
              d?.currentPrice ?? null,
              latestFinancials[secCode],
              d,
            );
            return (
              <TableRow
                key={secCode}
                className="hover:bg-muted/30 transition-colors"
              >
                <TableCell className="font-mono text-sm">{secCode}</TableCell>
                <TableCell className="max-w-[180px] truncate text-sm">
                  {companyName ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {loading ? (
                    <span className="text-xs">取得中…</span>
                  ) : (
                    d.industry ?? "—"
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-sm bg-amber-50/40 dark:bg-amber-900/20">
                  <Val value={d?.currentPrice} decimals={0} suffix=" 円" loading={loading} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-sm bg-orange-50/40 dark:bg-orange-900/20">
                  <Val value={per} decimals={1} suffix=" 倍" loading={loading} />
                  <RefNote value={yahooPer} decimals={1} suffix=" 倍" />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-sm bg-rose-50/40 dark:bg-rose-900/20">
                  <Val value={pbr} decimals={2} suffix=" 倍" loading={loading} />
                  <RefNote value={yahooPbr} decimals={2} suffix=" 倍" />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-sm bg-teal-50/40 dark:bg-teal-900/20">
                  <Val value={dividendYield} decimals={2} suffix="%" loading={loading} />
                  <RefNote value={yahooDividendYield} decimals={2} suffix="%" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="px-4 py-2 text-xs text-muted-foreground border-t">
        ※ 株価はYahoo Financeより取得（遅延あり）。PER・PBR・配当利回りは前日終値 × EDINETの実績EPS/BPS/DPSで算出（実績ベースのため、Yahoo等サイトの「会社予想」基準の数値とは一致しません）。「Yahoo参考」はYahoo Finance自身のEPS/BPS/DPS（TTM基準）で同じ株価から算出した値で、データの食い違いがないかのクロスチェック用です。業種はJPX 33業種区分。
      </p>
    </div>
  );
}
