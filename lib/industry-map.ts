// Yahoo Finance 英語業種名 → JPX 33業種区分（日本語）
const MAP: Record<string, string> = {
  // 輸送用機器
  "Auto Manufacturers": "輸送用機器",
  "Auto Parts": "輸送用機器",
  "Aerospace & Defense": "輸送用機器",
  "Auto & Truck Dealerships": "卸売業",

  // 電気機器
  "Consumer Electronics": "電気機器",
  "Electronic Components": "電気機器",
  "Electronic Gaming & Multimedia": "電気機器",
  "Semiconductors": "電気機器",
  "Semiconductor Equipment & Materials": "電気機器",
  "Communication Equipment": "電気機器",
  "Electrical Equipment & Parts": "電気機器",

  // 精密機器
  "Medical Devices": "精密機器",
  "Medical Instruments & Supplies": "精密機器",
  "Diagnostics & Research": "精密機器",
  "Scientific & Technical Instruments": "精密機器",
  "Photo Equipment & Supplies": "精密機器",

  // 情報・通信業
  "Telecom Services": "情報・通信業",
  "Internet Content & Information": "情報・通信業",
  "Software - Application": "情報・通信業",
  "Software - Infrastructure": "情報・通信業",
  "Information Technology Services": "情報・通信業",
  "Internet Retail": "情報・通信業",
  "Publishing": "情報・通信業",

  // 機械
  "Machinery": "機械",
  "Farm & Heavy Construction Machinery": "機械",
  "Specialty Industrial Machinery": "機械",
  "Tools & Accessories": "機械",
  "Industrial Machinery": "機械",

  // 化学
  "Chemicals": "化学",
  "Specialty Chemicals": "化学",
  "Diversified Chemicals": "化学",
  "Agricultural Inputs": "化学",

  // 医薬品
  "Drug Manufacturers - General": "医薬品",
  "Drug Manufacturers - Specialty & Generic": "医薬品",
  "Biotechnology": "医薬品",
  "Pharmaceutical Retailers": "医薬品",

  // 食料品
  "Packaged Foods": "食料品",
  "Beverages - Non-Alcoholic": "食料品",
  "Beverages - Alcoholic": "食料品",
  "Tobacco": "食料品",
  "Confectioners": "食料品",
  "Farm Products": "食料品",

  // 小売業
  "Grocery Stores": "小売業",
  "Department Stores": "小売業",
  "Specialty Retail": "小売業",
  "Apparel Retail": "小売業",
  "Restaurants": "小売業",
  "Home Improvement Retail": "小売業",
  "Drug Stores": "小売業",
  "Discount Stores": "小売業",

  // 卸売業
  "Industrial Distribution": "卸売業",
  "Food Distribution": "卸売業",
  "Wholesale": "卸売業",
  "Electronics Distribution": "卸売業",

  // 銀行業
  "Banks - Regional": "銀行業",
  "Banks - Diversified": "銀行業",
  "Banks": "銀行業",

  // 保険業
  "Insurance - Life": "保険業",
  "Insurance - Property & Casualty": "保険業",
  "Insurance - Diversified": "保険業",
  "Insurance": "保険業",

  // 証券、商品先物取引業
  "Capital Markets": "証券、商品先物取引業",

  // その他金融業
  "Asset Management": "その他金融業",
  "Financial Data & Stock Exchanges": "その他金融業",
  "Credit Services": "その他金融業",
  "Mortgage Finance": "その他金融業",
  "Financial Conglomerates": "その他金融業",

  // 不動産業
  "Real Estate - General": "不動産業",
  "Real Estate - Development": "不動産業",
  "Real Estate - Diversified": "不動産業",
  "Real Estate Investment Trusts (REITs)": "不動産業",
  "Real Estate Services": "不動産業",

  // 建設業
  "Construction": "建設業",
  "Engineering & Construction": "建設業",
  "Residential Construction": "建設業",

  // 鉄鋼
  "Steel": "鉄鋼",

  // 非鉄金属
  "Aluminum": "非鉄金属",
  "Copper": "非鉄金属",
  "Other Industrial Metals & Mining": "非鉄金属",

  // 金属製品
  "Metal Fabrication": "金属製品",

  // ゴム製品
  "Rubber & Plastics": "ゴム製品",

  // ガラス・土石製品
  "Ceramics & Glass": "ガラス・土石製品",
  "Building Materials": "ガラス・土石製品",

  // パルプ・紙
  "Paper & Paper Products": "パルプ・紙",
  "Lumber & Wood Production": "パルプ・紙",

  // 繊維製品
  "Apparel Manufacturing": "繊維製品",
  "Textiles": "繊維製品",
  "Footwear & Accessories": "繊維製品",

  // 石油・石炭製品
  "Oil & Gas Integrated": "石油・石炭製品",
  "Oil & Gas Refining & Marketing": "石油・石炭製品",
  "Oil & Gas E&P": "石油・石炭製品",

  // 電気・ガス業
  "Utilities - Regulated Electric": "電気・ガス業",
  "Utilities - Regulated Gas": "電気・ガス業",
  "Utilities - Diversified": "電気・ガス業",
  "Utilities - Independent Power Producers": "電気・ガス業",

  // 陸運業
  "Trucking": "陸運業",
  "Railroads": "陸運業",

  // 海運業
  "Marine Shipping": "海運業",

  // 空運業
  "Airlines": "空運業",

  // 倉庫・運輸関連業
  "Integrated Freight & Logistics": "倉庫・運輸関連業",
  "Shipping & Ports": "倉庫・運輸関連業",

  // 鉱業
  "Coal": "鉱業",
  "Gold": "鉱業",
  "Other Precious Metals & Mining": "鉱業",

  // その他製品
  "Conglomerates": "その他製品",
  "Household & Personal Products": "その他製品",
  "Furniture, Fixtures & Appliances": "その他製品",
  "Toys & Hobbies": "その他製品",
  "Sporting & Recreation": "その他製品",

  // サービス業
  "Staffing & Employment Services": "サービス業",
  "Security & Protection Services": "サービス業",
  "Waste Management": "サービス業",
  "Education & Training Services": "サービス業",
  "Advertising Agencies": "サービス業",
  "Entertainment": "サービス業",
  "Recreation": "サービス業",
  "Hotels & Motels": "サービス業",
  "Travel Services": "サービス業",
  "Personal Services": "サービス業",
  "Gambling": "サービス業",
  "Health Care Plans": "サービス業",
  "Leisure": "サービス業",

  // 水産・農林業
  "Agricultural Operations": "水産・農林業",
  "Fishing": "水産・農林業",
};

export function toJaIndustry(english: string | null): string | null {
  if (!english) return null;
  return MAP[english] ?? english;
}
