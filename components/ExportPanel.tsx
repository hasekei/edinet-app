"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ExportRow } from "@/types/financial";

interface Props {
  rows: ExportRow[];
}

export default function ExportPanel({ rows }: Props) {
  const [loading, setLoading] = useState<"csv" | "excel" | "sheets" | null>(null);
  const [sheetsUrl, setSheetsUrl] = useState<string | null>(null);

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
    setSheetsUrl(null);
    try {
      const res = await fetch("/api/sheets-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `エラー (HTTP ${res.status})`);
      setSheetsUrl(data.url);
      toast.success("Googleスプレッドシートを作成しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
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
          onClick={handleGoogleSheets}
          disabled={loading !== null}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          {loading === "sheets" ? "作成中..." : "Google スプレッドシート"}
        </Button>
      </div>

      {sheetsUrl && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm">
          <span className="text-muted-foreground">スプレッドシートを作成しました:</span>
          <a
            href={sheetsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-green-400 underline underline-offset-2 hover:text-green-300"
          >
            開く →
          </a>
        </div>
      )}
    </div>
  );
}
