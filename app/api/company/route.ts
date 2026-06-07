import { NextRequest, NextResponse } from "next/server";
import { findDocumentsBySecCode } from "@/lib/edinet-client";

export async function GET(req: NextRequest) {
  const secCode = req.nextUrl.searchParams.get("secCode");
  if (!secCode || !/^\d{4}$/.test(secCode)) {
    return NextResponse.json(
      { error: "4桁の証券コードを入力してください" },
      { status: 400 }
    );
  }

  try {
    const docs = await findDocumentsBySecCode(secCode, "120", 400);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: "有価証券報告書が見つかりませんでした" },
        { status: 404 }
      );
    }

    const latest = docs[0];
    return NextResponse.json({
      edinetCode: latest.edinetCode,
      secCode: latest.secCode?.slice(0, 4) ?? secCode,
      filerName: latest.filerName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
