export type AccountingStandard = "JGAAP" | "IFRS" | "US_GAAP" | "Unknown";

export interface FinancialData {
  secCode: string;
  companyName: string;
  edinetCode: string;
  docID: string;
  fiscalYear: string;
  periodEnd: string;
  submitDateTime: string;
  accountingStandard: AccountingStandard;
  isConsolidated: boolean;
  netSales: number | null;
  operatingIncome: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  dps: number | null;
}

export interface DocumentInfo {
  docID: string;
  edinetCode: string;
  secCode: string;
  filerName: string;
  docTypeCode: string;
  periodEnd: string;
  submitDateTime: string;
}

export interface CompanyInfo {
  edinetCode: string;
  secCode: string;
  filerName: string;
}

export interface BatchResult {
  secCode: string;
  companyName?: string;
  status: "pending" | "processing" | "done" | "error";
  data?: FinancialData;
  multipleData?: FinancialData[];
  error?: string;
}

export interface MarketData {
  secCode: string;
  currentPrice: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  industry: string | null;
}

export interface ExportRow {
  secCode: string;
  companyName: string;
  industry: string | null;
  currentPrice: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  marginRatio: number | null;
  periodEnd: string;
  netSales: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  dps: number | null;
  submitDateTime: string | null;
}
