import { NextRequest, NextResponse } from "next/server";
import { buildCache, searchCache, cacheStats } from "@/lib/company-cache";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";

  // キャッシュが空なら構築開始（非同期・待機なし）
  const stats = cacheStats();
  if (!stats.ready && !stats.building) {
    buildCache().catch(console.error);
  }

  // キャッシュが準備できていれば検索、未完なら部分結果を返す
  const results = searchCache(q);

  return NextResponse.json({
    results,
    cacheReady: stats.ready,
    building: stats.building,
    total: stats.count,
  });
}
