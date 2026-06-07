import { NextRequest, NextResponse } from "next/server";
import { findDocumentsBySecCode } from "@/lib/edinet-client";

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "5");

  if (!secCode || !/^\d{4}$/.test(secCode)) {
    return NextResponse.json(
      { error: "4桁の証券コードを入力してください" },
      { status: 400 }
    );
  }

  try {
    const docs = await findDocumentsBySecCode(secCode, "120", 400);
    return NextResponse.json({ documents: docs.slice(0, limit) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
