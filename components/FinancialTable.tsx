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
import type { BatchResult } from "@/types/financial";

interface Props {
  results: BatchResult[];
}

// 百万円単位の数値を億円・兆円に変換して表示
function formatJPY(v: number | null | undefined): { text: string; negative: boolean } {
  if (v === null || v === undefined) return { text: "—", negative: false };
  const negative = v < 0;
  const abs = Math.abs(v);

  let text: string;
  // v は百万円単位
  if (abs >= 1_000_000) {
    // 1兆円以上
    text = (v / 1_000_000).toLocaleString("ja-JP", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " 兆円";
  } else if (abs >= 10_000) {
    // 1兆円未満・100億円以上 → X,XXX億円
    text = Math.round(v / 100).toLocaleString("ja-JP") + " 億円";
  } else if (abs >= 100) {
    // 100億円未満・1億円以上 → XX.X億円
    text = (v / 100).toLocaleString("ja-JP", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " 億円";
  } else {
    // 1億円未満 → そのまま百万円
    text = v.toLocaleString("ja-JP") + " 百万円";
  }

  return { text, negative };
}

// 利益系セルの背景色（列インデックスに応じた薄い背景）
const COL_BG = [
  "bg-blue-50/40 dark:bg-blue-950/20",   // 売上高
  "bg-purple-50/40 dark:bg-purple-950/20", // 営業利益
  "bg-indigo-50/40 dark:bg-indigo-950/20", // 経常利益
  "bg-emerald-50/40 dark:bg-emerald-950/20", // 純利益
];

const COL_HEAD_BG = [
  "bg-blue-100/60 dark:bg-blue-900/30",
  "bg-purple-100/60 dark:bg-purple-900/30",
  "bg-indigo-100/60 dark:bg-indigo-900/30",
  "bg-emerald-100/60 dark:bg-emerald-900/30",
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

export default function FinancialTable({ results }: Props) {
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
                className={[
                  "text-right font-semibold whitespace-nowrap",
                  COL_HEAD_BG[i],
                ].join(" ")}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, i) => (
            <TableRow
              key={`${d.secCode}-${d.periodEnd}-${i}`}
              className="hover:bg-muted/30 transition-colors"
            >
              <TableCell className="font-mono text-sm">{d.secCode}</TableCell>
              <TableCell className="max-w-[180px] truncate text-sm">
                {d.companyName}
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap">{d.periodEnd}</TableCell>
              <TableCell>
                <Badge variant={d.isConsolidated ? "default" : "secondary"} className="text-xs">
                  {d.isConsolidated ? "連結" : "単体"}
                </Badge>
              </TableCell>
              <NumCell value={d.netSales} colIdx={0} />
              <NumCell value={d.operatingIncome} colIdx={1} />
              <NumCell value={d.ordinaryIncome} colIdx={2} />
              <NumCell value={d.netIncome} colIdx={3} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-4 py-2 text-xs text-muted-foreground border-t">
        ※ XBRL原値（百万円単位）を億円・兆円に変換して表示。▼ は赤字を示します。
      </p>
    </div>
  );
}
