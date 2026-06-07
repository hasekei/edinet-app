"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ExportRow } from "@/types/financial";

interface Props {
  rows: ExportRow[];
}

export default function ExportPanel({ rows }: Props) {
  const [loading, setLoading] = useState<"csv" | "excel" | null>(null);

  if (rows.length === 0) return null;

  async function handleExport(format: "csv" | "excel") {
    setLoading(format);
    try {
      const res = await fetch(`/api/export?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error("エクスポート失敗");

      const blob = await res.blob();
      const ext = format === "excel" ? "xlsx" : "csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `財務データ.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${format === "excel" ? "Excel" : "CSV"}をダウンロードしました`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エクスポートエラー");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        onClick={() => handleExport("csv")}
        disabled={loading !== null}
      >
        {loading === "csv" ? "処理中..." : "CSV ダウンロード"}
      </Button>
      <Button
        onClick={() => handleExport("excel")}
        disabled={loading !== null}
      >
        {loading === "excel" ? "処理中..." : "Excel ダウンロード"}
      </Button>
    </div>
  );
}
