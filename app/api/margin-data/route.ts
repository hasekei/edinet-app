import { NextRequest, NextResponse } from "next/server";
import { fetchMarginRatio } from "@/lib/jpx-margin";

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  if (!secCode || !/^\d{4}$/.test(secCode)) {
    return NextResponse.json({ error: "Invalid secCode" }, { status: 400 });
  }

  try {
    const marginRatio = await fetchMarginRatio(secCode);
    return NextResponse.json({ secCode, marginRatio });
  } catch {
    return NextResponse.json({ secCode, marginRatio: null });
  }
}
