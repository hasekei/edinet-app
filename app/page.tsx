"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import CompanySearch from "@/components/CompanySearch";
import FinancialTable from "@/components/FinancialTable";
import ExportPanel from "@/components/ExportPanel";
import StatusList from "@/components/StatusList";
import type { BatchResult, FinancialData, MarketData, ExportRow, ForecastData } from "@/types/financial";
import { calcTheoreticalPrice } from "@/lib/theoretical-price";
import MarketDataTable from "@/components/MarketDataTable";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => currentYear - 10 + i);

function YearRangePicker({
  enabled,
  onToggle,
  fromYear,
  toYear,
  onFromChange,
  onToChange,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  fromYear: number;
  toYear: number;
  onFromChange: (v: number) => void;
  onToChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded"
        />
        期間を指定して複数年取得
        <span className="text-xs text-muted-foreground">（指定なしで直近を取得）</span>
      </label>
      {enabled && (
        <div className="flex items-center gap-2 pl-6 text-sm">
          <select
            value={fromYear}
            onChange={(e) => onFromChange(Number(e.target.value))}
            className="rounded-md border px-2 py-1.5 text-sm bg-background"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <span className="text-muted-foreground">〜</span>
          <select
            value={toYear}
            onChange={(e) => onToChange(Number(e.target.value))}
            className="rounded-md border px-2 py-1.5 text-sm bg-background"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">（会計期間終了年）</span>
        </div>
      )}
    </div>
  );
}

async function fetchFinancials(
  secCode: string,
  useRange: boolean,
  fromYear: number,
  toYear: number
): Promise<{ data?: FinancialData; multipleData?: FinancialData[] }> {
  let url = `/api/financials?secCode=${secCode}`;
  if (useRange) url += `&fromYear=${fromYear}&toYear=${toYear}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "取得失敗");
  if (json.multiple) return { multipleData: json.data as FinancialData[] };
  return { data: json.data as FinancialData };
}

export default function Home() {
  // 単一検索
  const [singleCode, setSingleCode] = useState("");
  const [singleName, setSingleName] = useState("");
  const [singleUseRange, setSingleUseRange] = useState(false);
  const [singleFromYear, setSingleFromYear] = useState(currentYear - 2);
  const [singleToYear, setSingleToYear] = useState(currentYear);

  // 一括処理
  const [batchText, setBatchText] = useState("");
  const [batchUseRange, setBatchUseRange] = useState(false);
  const [batchFromYear, setBatchFromYear] = useState(currentYear - 2);
  const [batchToYear, setBatchToYear] = useState(currentYear);

  // 共通
  const [results, setResults] = useState<BatchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [forecastData, setForecastData] = useState<Record<string, ForecastData>>({});
  const resultsRef = useRef<HTMLElement>(null);

  const doneRows = results.flatMap((r) => {
    if (r.status !== "done") return [];
    if (r.multipleData) return r.multipleData;
    if (r.data) return [r.data];
    return [];
  });

  const exportRows: ExportRow[] = doneRows.map((d) => {
    const m = marketData[d.secCode];
    const f = forecastData[d.secCode];
    const tp = f ? calcTheoreticalPrice(f, d.netIncome, d.eps) : null;
    return {
      secCode: d.secCode,
      companyName: d.companyName,
      industry: m?.industry ?? null,
      currentPrice: m?.currentPrice ?? null,
      per: m?.per ?? null,
      pbr: m?.pbr ?? null,
      dividendYield: m?.dividendYield ?? null,
      marginRatio: m?.marginRatio ?? null,
      periodEnd: d.periodEnd,
      netSales: d.netSales,
      ordinaryIncome: d.ordinaryIncome,
      netIncome: d.netIncome,
      eps: d.eps,
      dps: d.dps,
      submitDateTime: d.submitDateTime ?? null,
      forecastOrdinaryIncome: f?.forecastOrdinaryIncome ?? null,
      bps: f?.bps ?? null,
      equityRatio: f?.equityRatio ?? null,
      sharesEstimate: tp?.sharesEstimate ?? null,
      calcEps: tp?.calcEps ?? null,
      equityRatioPct: tp?.equityRatioPct ?? null,
      roa: tp?.roa ?? null,
      leverage: tp?.leverage ?? null,
      discountRate: tp?.discountRate ?? null,
      businessValue: tp?.businessValue ?? null,
      assetValue: tp?.assetValue ?? null,
      theoreticalPrice: tp?.price ?? null,
    };
  });

  function fetchMarketDataBg(code: string) {
    fetch(`/api/market-data?secCode=${code}`)
      .then((r) => r.json())
      .then((market: MarketData & { error?: string }) => {
        if (market && !market.error) {
          setMarketData((prev) => ({
            ...prev,
            [code]: { ...market, marginRatio: null },
          }));
        }
      })
      .catch(() => {});
  }

  function fetchForecastBg(code: string) {
    fetch(`/api/forecast?secCode=${code}`)
      .then((r) => r.json())
      .then((data: ForecastData) => {
        setForecastData((prev) => ({ ...prev, [code]: data }));
      })
      .catch(() => {});
  }

  async function handleSingle() {
    const code = singleCode.trim();
    if (!/^\d{4}$/.test(code)) {
      toast.error("4桁の証券コードを入力してください");
      return;
    }
    if (singleUseRange && singleFromYear > singleToYear) {
      toast.error("開始年は終了年以前にしてください");
      return;
    }
    setRunning(true);
    setMarketData({});
    setForecastData({});
    setResults([{ secCode: code, companyName: singleName, status: "processing" }]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    try {
      const result = await fetchFinancials(code, singleUseRange, singleFromYear, singleToYear);
      const name = result.data?.companyName ?? result.multipleData?.[0]?.companyName ?? singleName;
      setResults([{ secCode: code, companyName: name, status: "done", ...result }]);
      toast.success(`${name} のデータを取得しました`);
      fetchMarketDataBg(code);
      fetchForecastBg(code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults([{ secCode: code, status: "error", error: msg }]);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function handleBatch() {
    const codes = batchText
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}$/.test(s));

    if (codes.length === 0) {
      toast.error("有効な4桁の証券コードが見つかりません");
      return;
    }
    if (codes.length > 70) {
      toast.error("一度に処理できるのは70社までです");
      return;
    }
    if (batchUseRange && batchFromYear > batchToYear) {
      toast.error("開始年は終了年以前にしてください");
      return;
    }

    setRunning(true);
    setMarketData({});
    setForecastData({});
    const initial: BatchResult[] = codes.map((c) => ({ secCode: c, status: "pending" }));
    setResults(initial);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    const updated = [...initial];

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      updated[i] = { ...updated[i], status: "processing" };
      setResults([...updated]);
      try {
        const result = await fetchFinancials(code, batchUseRange, batchFromYear, batchToYear);
        const name = result.data?.companyName ?? result.multipleData?.[0]?.companyName;
        updated[i] = { secCode: code, companyName: name, status: "done", ...result };
        fetchMarketDataBg(code);
        fetchForecastBg(code);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updated[i] = { secCode: code, status: "error", error: msg };
      }
      setResults([...updated]);
      if (i < codes.length - 1) await sleep(600);
    }

    const doneCount = updated.filter((r) => r.status === "done").length;
    const errCount = updated.filter((r) => r.status === "error").length;
    toast.success(`完了: ${doneCount}社成功${errCount > 0 ? `、${errCount}社エラー` : ""}`);
    setRunning(false);
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-300 via-cyan-200 to-blue-300 bg-clip-text text-transparent">
          EDINET 財務データ抽出ツール
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          証券コードまたは会社名を入力してEDINETから財務データを取得します
        </p>
      </div>

      {/* 単一検索 */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold">単一企業検索</h2>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">会社名で検索（候補選択で証券コードが自動入力）</label>
          <CompanySearch
            onSelect={(code, name) => {
              setSingleCode(code);
              setSingleName(name);
            }}
          />
        </div>

        <div className="max-w-sm space-y-1">
          <label className="text-xs text-muted-foreground">証券コード（4桁）</label>
          <Input
            placeholder="例: 7203"
            value={singleCode}
            onChange={(e) => setSingleCode(e.target.value)}
            maxLength={4}
            className="font-mono"
            onKeyDown={(e) => { if (e.key === "Enter" && !running) handleSingle(); }}
          />
        </div>

        <YearRangePicker
          enabled={singleUseRange}
          onToggle={setSingleUseRange}
          fromYear={singleFromYear}
          toYear={singleToYear}
          onFromChange={setSingleFromYear}
          onToChange={setSingleToYear}
        />

        <Button onClick={handleSingle} disabled={running || !singleCode}>
          {running && results.length === 1 ? "取得中..." : "検索"}
        </Button>
      </section>

      {/* 一括処理 */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold">一括処理（最大70社）</h2>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            証券コードを改行・カンマ・スペース区切りで入力
          </label>
          <Textarea
            placeholder={"7203\n6758\n9984\n4755"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            rows={5}
            className="font-mono text-sm"
          />
        </div>

        <YearRangePicker
          enabled={batchUseRange}
          onToggle={setBatchUseRange}
          fromYear={batchFromYear}
          toYear={batchToYear}
          onFromChange={setBatchFromYear}
          onToChange={setBatchToYear}
        />

        <Button onClick={handleBatch} disabled={running || !batchText.trim()}>
          {running && results.length > 1 ? "処理中..." : "一括実行"}
        </Button>
      </section>

      {results.length > 0 && (
        <section ref={resultsRef}>
          <StatusList results={results} />
        </section>
      )}

      {doneRows.length > 0 && (
        <section className="space-y-8">
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              市場データ
            </h2>
            <MarketDataTable
              companies={[
                ...new Map(
                  doneRows.map((d) => [
                    d.secCode,
                    { secCode: d.secCode, companyName: d.companyName },
                  ])
                ).values(),
              ]}
              marketData={marketData}
            />
          </div>
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              財務データ（有価証券報告書）
            </h2>
            <FinancialTable results={results} forecastData={forecastData} marketData={marketData} />
            <ExportPanel rows={exportRows} />
          </div>
        </section>
      )}
    </main>
  );
}
