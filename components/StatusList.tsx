"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { BatchResult } from "@/types/financial";

interface Props {
  results: BatchResult[];
}

const STATUS_LABEL: Record<BatchResult["status"], string> = {
  pending: "待機中",
  processing: "取得中",
  done: "完了",
  error: "エラー",
};

const STATUS_VARIANT: Record<
  BatchResult["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  processing: "secondary",
  done: "default",
  error: "destructive",
};

export default function StatusList({ results }: Props) {
  if (results.length === 0) return null;

  const done = results.filter((r) => r.status === "done" || r.status === "error").length;
  const total = results.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Progress value={pct} className="flex-1" />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {done} / {total}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {results.map((r) => (
          <div
            key={r.secCode}
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            title={r.error}
          >
            <span className="font-mono">{r.secCode}</span>
            <Badge variant={STATUS_VARIANT[r.status]} className="text-xs py-0">
              {STATUS_LABEL[r.status]}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
