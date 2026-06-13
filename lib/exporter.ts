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
  // 理論株価 計算過程
  "予想経常利益",
  "BPS",
  "自己資本比率(%)",
  "発行済株式数（推計）",
  "計算用EPS",
  "ROA",
  "財務レバレッジ補正",
  "割引評価率",
  "事業価値",
  "資産価値",
  "理論株価",
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
    // 理論株価 計算過程
    d.forecastOrdinaryIncome,
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
  // 列: 1=コード 2=名 3=業種 4=終値 5=PER 6=PBR 7=利回 8=決算期
  //     9=売上 10=経常 11=純利 12=EPS 13=DPS 14=発表
  //     15=予想経常 16=BPS 17=自己資本比率 18=株式数推計 19=計算EPS
  //     20=ROA 21=財務レバレッジ 22=割引評価率 23=事業価値 24=資産価値 25=理論株価
  const numericCols = [4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
  ws.columns.forEach((col, idx) => {
    const colNo = idx + 1;
    col.width = colNo === 2 ? 28 : colNo === 3 ? 18 : 14;
    if (numericCols.includes(colNo)) {
      col.alignment = { horizontal: "right" };
      // 小数4桁 (ROA, 割引評価率, 財務レバレッジ)
      if ([20, 21, 22].includes(colNo)) {
        col.numFmt = "#,##0.0000";
      // 整数系
      } else if ([4, 9, 10, 11, 12, 13, 15, 16, 18, 19, 23, 24, 25].includes(colNo)) {
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
