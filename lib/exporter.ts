import ExcelJS from "exceljs";
import type { FinancialData } from "@/types/financial";

const HEADERS = [
  "証券コード",
  "会社名",
  "会計期間終了日",
  "連結/単体",
  "会計基準",
  "売上高",
  "営業利益",
  "経常利益",
  "純利益",
];

function formatRow(d: FinancialData): (string | number | null)[] {
  return [
    d.secCode,
    d.companyName,
    d.periodEnd,
    d.isConsolidated ? "連結" : "単体",
    d.accountingStandard,
    d.netSales,
    d.operatingIncome,
    d.ordinaryIncome,
    d.netIncome,
  ];
}

export function toCSV(rows: FinancialData[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows) {
    const cells = formatRow(row).map((v) => {
      if (v === null) return "";
      const str = String(v);
      return str.includes(",") ? `"${str}"` : str;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export async function toExcel(rows: FinancialData[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("財務データ");

  // ヘッダー行
  ws.addRow(HEADERS);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3864" },
  };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

  // データ行
  for (const d of rows) {
    ws.addRow(formatRow(d));
  }

  // 列幅と書式設定
  const numericCols = [6, 7, 8, 9]; // 売上高〜純利益
  ws.columns.forEach((col, idx) => {
    col.width = idx === 1 ? 30 : 16;
    if (numericCols.includes(idx + 1)) {
      col.numFmt = "#,##0";
      col.alignment = { horizontal: "right" };
    }
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
