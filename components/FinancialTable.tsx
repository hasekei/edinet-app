"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BatchResult, ForecastData, MarketData } from "@/types/financial";
import { calcTheoreticalPrice } from "@/lib/theoretical-price";

interface Props {
  results: BatchResult[];
  forecastData: Record<string, ForecastData>;
  marketData: Record<string, MarketData>;
}

function formatJPY(v: number | null | undefined): { text: string; negative: boolean } {
  if (v === null || v === undefined) return { text: "—", negative: false };
  const negative = v < 0;
  const abs = Math.abs(v);

  let text: string;
  if (abs >= 1e8) {
    if (abs >= 1e12) {
      text = (v / 1e12).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " 兆円";
    } else {
      text = Math.round(v / 1e8).toLocaleString("ja-JP") + " 億円";
    }
  } else {
    if (abs >= 1_000_000) {
      text = (v / 1_000_000).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " 兆円";
    } else if (abs >= 10_000) {
      text = Math.round(v / 100).toLocaleString("ja-JP") + " 億円";
    } else if (abs >= 100) {
      text = (v / 100).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " 億円";
    } else {
      text = v.toLocaleString("ja-JP") + " 百万円";
    }
  }

  return { text, negative };
}

const COL_BG = [
  "bg-blue-50/40 dark:bg-blue-900/25",
  "bg-purple-50/40 dark:bg-purple-900/25",
  "bg-indigo-50/40 dark:bg-indigo-900/25",
  "bg-emerald-50/40 dark:bg-emerald-900/25",
];

const COL_HEAD_BG = [
  "bg-blue-100/60 dark:bg-blue-800/40",
  "bg-purple-100/60 dark:bg-purple-800/40",
  "bg-indigo-100/60 dark:bg-indigo-800/40",
  "bg-emerald-100/60 dark:bg-emerald-800/40",
];

function NumCell({ value, colIdx }: { value: number | null | undefined; colIdx: number }) {
  const { text, negative } = formatJPY(value);
  return (
    <TableCell
      className={[
        "text-right font-mono tabular-nums text-sm",
        COL_BG[colIdx],
        negative ? "text-red-600 dark:text-red-400 font-semibold" : "",
      ].join(" ")}
    >
      {negative && value !== null ? `▼ ${text}` : text}
    </TableCell>
  );
}

function TheoreticalCell({
  theoreticalPrice,
  currentPrice,
  loading,
}: {
  theoreticalPrice: number | null;
  currentPrice: number | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <TableCell className="text-right text-xs text-muted-foreground bg-yellow-50/40 dark:bg-yellow-900/20 whitespace-nowrap">
        取得中…
      </TableCell>
    );
  }
  if (theoreticalPrice == null) {
    return (
      <TableCell className="text-right text-muted-foreground bg-yellow-50/40 dark:bg-yellow-900/20">—</TableCell>
    );
  }

  const priceText = theoreticalPrice.toLocaleString("ja-JP") + " 円";

  let upsideEl: React.ReactNode = null;
  if (currentPrice && currentPrice > 0) {
    const upside = ((theoreticalPrice - currentPrice) / currentPrice) * 100;
    const up = upside >= 0;
    upsideEl = (
      <span className={["text-xs ml-1", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"].join(" ")}>
        {up ? "▲" : "▼"}{Math.abs(upside).toFixed(1)}%
      </span>
    );
  }

  return (
    <TableCell className="text-right font-mono tabular-nums text-sm bg-yellow-50/40 dark:bg-yellow-900/20 whitespace-nowrap">
      {priceText}
      {upsideEl}
    </TableCell>
  );
}

export default function FinancialTable({ results, forecastData, marketData }: Props) {
  const rows = results.flatMap((r) => {
    if (r.status !== "done") return [];
    if (r.multipleData) return r.multipleData;
    if (r.data) return [r.data];
    return [];
  });

  if (rows.length === 0) return null;

  const headers = ["売上高", "営業利益", "経常利益", "純利益"];

  return (
    <div className="overflow-x-auto rounded-lg border shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold whitespace-nowrap">証券コード</TableHead>
            <TableHead className="font-semibold">会社名</TableHead>
            <TableHead className="font-semibold whitespace-nowrap">会計期間終了</TableHead>
            <TableHead className="font-semibold">区分</TableHead>
            {headers.map((h, i) => (
              <TableHead
                key={h}
                className={["text-right font-semibold whitespace-nowrap", COL_HEAD_BG[i]].join(" ")}
              >
                {h}
              </TableHead>
            ))}
            <TableHead className="text-right font-semibold whitespace-nowrap bg-yellow-100/60 dark:bg-yellow-800/40">
              理論株価
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, i) => {
            const f = forecastData[d.secCode];
            const m = marketData[d.secCode];
            const tpResult = f ? calcTheoreticalPrice(f, d.netIncome, d.eps) : null;
            const theoreticalPrice = tpResult?.price ?? null;
            const forecastLoading = !f;

            return (
              <TableRow
                key={`${d.secCode}-${d.periodEnd}-${i}`}
                className="hover:bg-muted/30 transition-colors"
              >
                <TableCell className="font-mono text-sm">{d.secCode}</TableCell>
                <TableCell className="max-w-[180px] truncate text-sm">{d.companyName}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{d.periodEnd}</TableCell>
                <TableCell className="whitespace-nowrap space-x-1">
                  <Badge variant={d.isConsolidated ? "default" : "secondary"} className="text-xs">
                    {d.isConsolidated ? "連結" : "単体"}
                  </Badge>
                  {d.accountingStandard !== "JGAAP" && d.accountingStandard !== "Unknown" && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                      {d.accountingStandard}
                    </Badge>
                  )}
                </TableCell>
                <NumCell value={d.netSales} colIdx={0} />
                <NumCell value={d.operatingIncome} colIdx={1} />
                {d.accountingStandard === "IFRS" || d.accountingStandard === "US_GAAP" ? (
                  <TableCell className={["text-right text-sm tabular-nums", COL_BG[2]].join(" ")}>
                    <span className="text-muted-foreground text-xs">— ({d.accountingStandard})</span>
                  </TableCell>
                ) : (
                  <NumCell value={d.ordinaryIncome} colIdx={2} />
                )}
                <NumCell value={d.netIncome} colIdx={3} />
                <TheoreticalCell
                  theoreticalPrice={theoreticalPrice}
                  currentPrice={m?.currentPrice ?? null}
                  loading={forecastLoading}
                />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="px-4 py-2 text-xs text-muted-foreground border-t">
        ※ 億円・兆円単位に変換して表示。▼ は赤字を示します。理論株価は決算短信の予想経常利益・BPS・自己資本比率から算出（参考値）。
      </p>
    </div>
  );
}
