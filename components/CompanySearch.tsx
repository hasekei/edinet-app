"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import type { CachedCompany } from "@/lib/company-cache";

interface Props {
  onSelect: (secCode: string, name: string) => void;
  placeholder?: string;
}

export default function CompanySearch({ onSelect, placeholder = "会社名" }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 初回マウント時にキャッシュのウォームアップを開始
    fetch("/api/search-company?q=").catch(() => {});
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search-company?q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        setResults(json.results ?? []);
        setBuilding(json.building ?? false);
        setOpen(true);
      } catch {
        /* ignore */
      }
    }, 250);
  }, [query]);

  // 外側クリックでドロップダウンを閉じる
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(c: CachedCompany) {
    setQuery(c.filerName);
    setOpen(false);
    onSelect(c.secCode, c.filerName);
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {building && query && (
        <p className="absolute right-2 top-2.5 text-xs text-muted-foreground">
          検索インデックス構築中...
        </p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
          {results.map((c) => (
            <li
              key={c.edinetCode}
              className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent"
              onMouseDown={() => handleSelect(c)}
            >
              <span>{c.filerName}</span>
              <span className="ml-4 font-mono text-xs text-muted-foreground">
                {c.secCode}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && results.length === 0 && query && !building && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          候補が見つかりません（証券コードで直接入力してください）
        </div>
      )}
    </div>
  );
}
