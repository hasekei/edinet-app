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
  "決算期",
  "売上高",
  "経常利益",
  "最終利益",
  "1株利益",
  "1株配当",
  "発表日",
  "理論株価",
  "予想経常利益",
  "BPS",
  "自己資本比率(%)",
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
    d.netSales,
    d.ordinaryIncome,
    d.netIncome,
    d.eps,
    d.dps,
    d.submitDateTime ? d.submitDateTime.slice(0, 10) : "",
    d.theoreticalPrice,
    d.forecastOrdinaryIncome,
    d.bps,
    // 自己資本比率: 小数(0.35)の場合はパーセント表記(35.0)に変換
    d.equityRatio != null
      ? d.equityRatio <= 1
        ? Math.round(d.equityRatio * 1000) / 10
        : Math.round(d.equityRatio * 10) / 10
      : null,
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
  // 列: 1=コード 2=名 3=業種 4=終値 5=PER 6=PBR 7=利回 8=決算期 9=売上 10=経常 11=純利 12=EPS 13=DPS 14=発表 15=理論株価 16=予想経常 17=BPS 18=自己資本比率
  const numericCols = [4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18];
  ws.columns.forEach((col, idx) => {
    const colNo = idx + 1;
    col.width = colNo === 2 ? 28 : colNo === 3 ? 18 : 14;
    if (numericCols.includes(colNo)) {
      col.alignment = { horizontal: "right" };
      if ([4, 9, 10, 11, 12, 13, 15, 16, 17].includes(colNo)) {
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
