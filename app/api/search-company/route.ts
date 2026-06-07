import { NextRequest, NextResponse } from "next/server";
import { getCompanyList, searchCompanies } from "@/lib/company-cache";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const companies = await getCompanyList();
  const results = q ? searchCompanies(companies, q) : [];
  return NextResponse.json({
    results,
    cacheReady: true,
    building: false,
    total: companies.length,
  });
}
