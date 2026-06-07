import ExcelJS from "exceljs";
import type { ExportRow } from "@/types/financial";

const HEADERS = [
  "証券コード",
  "銘柄名",
  "業種",
  "前日終値",
  "PER",
  "PBR",
  "配当利回り(%)",
  "信用倍率",
  "決算期",
  "売上高",
  "経常利益",
  "最終利益",
  "1株利益",
  "1株配当",
  "発表日",
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
    d.marginRatio,
    d.periodEnd,
    d.netSales,
    d.ordinaryIncome,
    d.netIncome,
    d.eps,
    d.dps,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
  ];
}

export function toCSV(rows: ExportRow[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows) {
    const cells = formatRow(row).map((v) => {
      if (v === null || v === undefined) return "";
      const str = String(v);
      return str.includes(",") ? `"${str}"` : str;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export async function toExcel(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("財務データ");

  ws.addRow(HEADERS);
  const headerRow = ws.getRow(1);
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3864" },
  };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const d of rows) {
    ws.addRow(formatRow(d));
  }

  // 列幅・数値書式
  const numericCols = [4, 5, 6, 7, 8, 10, 11, 12, 13, 14]; // 数値列
  ws.columns.forEach((col, idx) => {
    const colNo = idx + 1;
    col.width = colNo === 2 ? 28 : colNo === 3 ? 18 : 14;
    if (numericCols.includes(colNo)) {
      col.alignment = { horizontal: "right" };
      // 整数列と小数列で書式を分ける
      if ([4, 10, 11, 12, 13, 14].includes(colNo)) {
        col.numFmt = "#,##0.##";
      } else {
        col.numFmt = "#,##0.00";
      }
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
