import ExcelJS from "exceljs";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード",
  "銘柄名",
  "業種",
  "前日終値（円）",
  "PER（倍）",
  "PBR（倍）",
  "配当利回り（%）",
  "決算期",
  "売上高（億円）",
  "経常利益（億円）",
  "最終利益（億円）",
  "1株利益（円）",
  "1株配当（円）",
  "発表日",
  // 理論株価 計算過程
  "計算用経常利益（億円）",
  "BPS（円）",
  "自己資本比率（%）",
  "発行済株式数・推計（株）",
  "計算用EPS（円）",
  "ROA",
  "財務レバレッジ補正",
  "割引評価率",
  "事業価値（円）",
  "資産価値（円）",
  "理論株価（円）",
];

function formatRow(d: ExportRow): (string | number | null)[] {
  return [
    d.secCode,
    d.companyName,
    d.industry ?? "",
    d.currentPrice,
    d.per,
    d.pbr,
    d.dividendYield,
    d.periodEnd,
    d.netSales != null ? d.netSales / 1e8 : null,
    d.ordinaryIncome != null ? d.ordinaryIncome / 1e8 : null,
    d.netIncome != null ? d.netIncome / 1e8 : null,
    d.eps,
    d.dps,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
    // 理論株価 計算過程
    d.calcOrdinaryIncome != null ? d.calcOrdinaryIncome / 1e8 : null,
    d.bps,
    d.equityRatioPct,
    d.sharesEstimate,
    d.calcEps,
    d.roa,
    d.leverage,
    d.discountRate,
    d.businessValue,
    d.assetValue,
    d.theoreticalPrice,
  ];
}

export function toCSV(rows: ExportRow[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows) {
    const cells = formatRow(row).map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "number") {
        const s = v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
        return `"${s}"`;
      }
      const str = String(v);
      return str.includes(",") ? `"${str}"` : str;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

// col.numFmt は行追加後に column 経由で設定しても既存セルに遡及しない。
// 行追加時にセル単位で設定することで確実に適用する。
const COL_NUM_FMT: Record<number, string> = {
  4:  "#,##0",     // 前日終値（円）
  5:  "0.0",       // PER（倍）
  6:  "0.00",      // PBR（倍）
  7:  "0.00",      // 配当利回り（%）
  9:  "#,##0.0",   // 売上高（億円）
  10: "#,##0.0",   // 経常利益（億円）
  11: "#,##0.0",   // 最終利益（億円）
  12: "#,##0.00",  // 1株利益（円）
  13: "#,##0",     // 1株配当（円）
  15: "#,##0.0",   // 計算用経常利益（億円）
  16: "#,##0.00",  // BPS（円）
  17: "0.0",       // 自己資本比率（%）
  18: "#,##0",     // 発行済株式数・推計（株）
  19: "#,##0.00",  // 計算用EPS（円）
  20: "0.0000",    // ROA
  21: "0.00",      // 財務レバレッジ補正
  22: "0.00",      // 割引評価率
  23: "#,##0",     // 事業価値（円）
  24: "#,##0",     // 資産価値（円）
  25: "#,##0",     // 理論株価（円）
};

export async function toExcel(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("財務データ");

  const headerRow = ws.addRow(HEADERS);
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3864" },
  };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const d of rows) {
    const dataRow = ws.addRow(formatRow(d));
    dataRow.eachCell({ includeEmpty: true }, (cell, colNo) => {
      const fmt = COL_NUM_FMT[colNo];
      if (fmt && typeof cell.value === "number") {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right" };
      }
    });
  }

  // 列幅
  ws.columns.forEach((col, idx) => {
    const colNo = idx + 1;
    col.width = colNo === 2 ? 28 : colNo === 3 ? 18 : 14;
  });

  // 枠線
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
