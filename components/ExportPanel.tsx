"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ExportRow } from "@/types/financial";
import { getGoogleAccessToken, createGoogleSpreadsheet } from "@/lib/google-sheets";

interface Props {
  rows: ExportRow[];
}

export default function ExportPanel({ rows }: Props) {
  const [loading, setLoading] = useState<"csv" | "excel" | "sheets" | null>(null);

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

  async function handleGoogleSheets() {
    setLoading("sheets");
    try {
      const token = await getGoogleAccessToken();
      const url = await createGoogleSpreadsheet(rows, token);
      window.open(url, "_blank");
      toast.success("Googleスプレッドシートを作成しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
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
      <Button
        variant="outline"
        onClick={handleGoogleSheets}
        disabled={loading !== null}
        className="border-green-500/50 text-green-400 hover:bg-green-500/10 dark:border-green-500/40 dark:text-green-400"
      >
        {loading === "sheets" ? "作成中..." : "Google スプレッドシート"}
      </Button>
    </div>
  );
}
