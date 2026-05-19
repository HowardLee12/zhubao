// Ready-made quote starting points so a new user reaches the dual-version
// pricing "aha" in seconds instead of facing a blank builder. Costs are
// rough Taiwan-market starting figures — the user edits them.

export interface QuoteTemplateItem {
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
}

export interface QuoteTemplateSection {
  name: string;
  icon: string;
  items: QuoteTemplateItem[];
}

export interface QuoteTemplate {
  id: string;
  label: string;
  desc: string;
  sections: QuoteTemplateSection[];
}

export const QUOTE_TEMPLATES: QuoteTemplate[] = [
  {
    id: "full-home",
    label: "小宅全室翻新",
    desc: "約 25 坪 · 7 個工程分類",
    sections: [
      {
        name: "拆除工程",
        icon: "🔨",
        items: [
          { name: "全室拆除清運", spec: "含舊櫃、地坪、衛浴打除", unit: "式", quantity: 1, unitCost: 48000, markupPercent: 25 },
        ],
      },
      {
        name: "水電工程",
        icon: "🔧",
        items: [
          { name: "全室水電重配", spec: "配電箱、迴路、給排水", unit: "式", quantity: 1, unitCost: 120000, markupPercent: 30 },
        ],
      },
      {
        name: "泥作工程",
        icon: "🧱",
        items: [
          { name: "衛浴防水+貼磚", spec: "1 套衛浴", unit: "式", quantity: 1, unitCost: 62000, markupPercent: 35 },
          { name: "地坪整平粉光", spec: "", unit: "坪", quantity: 25, unitCost: 1200, markupPercent: 30 },
        ],
      },
      {
        name: "木作工程",
        icon: "🪵",
        items: [
          { name: "系統櫃（玄關+電視牆）", spec: "含五金", unit: "式", quantity: 1, unitCost: 88000, markupPercent: 35 },
          { name: "天花板平釘", spec: "含燈孔", unit: "坪", quantity: 20, unitCost: 4200, markupPercent: 35 },
        ],
      },
      {
        name: "油漆工程",
        icon: "🎨",
        items: [
          { name: "全室乳膠漆", spec: "含批土", unit: "坪", quantity: 25, unitCost: 2200, markupPercent: 40 },
        ],
      },
      {
        name: "清潔工程",
        icon: "🧹",
        items: [
          { name: "完工細清", spec: "", unit: "式", quantity: 1, unitCost: 12000, markupPercent: 30 },
        ],
      },
    ],
  },
  {
    id: "bathroom",
    label: "衛浴翻新",
    desc: "單間 · 4 個工程分類",
    sections: [
      {
        name: "拆除工程",
        icon: "🔨",
        items: [
          { name: "衛浴打除清運", spec: "", unit: "式", quantity: 1, unitCost: 18000, markupPercent: 25 },
        ],
      },
      {
        name: "泥作工程",
        icon: "🧱",
        items: [
          { name: "防水施作", spec: "兩道防水", unit: "式", quantity: 1, unitCost: 15000, markupPercent: 35 },
          { name: "牆地磚鋪貼", spec: "含材料", unit: "坪", quantity: 4.5, unitCost: 8500, markupPercent: 35 },
        ],
      },
      {
        name: "水電工程",
        icon: "🔧",
        items: [
          { name: "衛浴配管配線", spec: "含糞管移位", unit: "式", quantity: 1, unitCost: 24000, markupPercent: 30 },
        ],
      },
      {
        name: "衛浴工程",
        icon: "🚿",
        items: [
          { name: "衛浴設備（馬桶+面盆+龍頭）", spec: "中等級", unit: "組", quantity: 1, unitCost: 38000, markupPercent: 30 },
          { name: "乾濕分離+五金配件", spec: "", unit: "式", quantity: 1, unitCost: 26000, markupPercent: 35 },
        ],
      },
    ],
  },
  {
    id: "commercial",
    label: "商空 / 店面",
    desc: "約 30 坪 · 5 個工程分類",
    sections: [
      {
        name: "拆除工程",
        icon: "🔨",
        items: [
          { name: "原況拆除清運", spec: "", unit: "式", quantity: 1, unitCost: 55000, markupPercent: 25 },
        ],
      },
      {
        name: "水電工程",
        icon: "🔧",
        items: [
          { name: "全室電力插座迴路", spec: "含獨立迴路", unit: "式", quantity: 1, unitCost: 98000, markupPercent: 30 },
        ],
      },
      {
        name: "木作工程",
        icon: "🪵",
        items: [
          { name: "輕隔間", spec: "含隔音棉", unit: "式", quantity: 1, unitCost: 68000, markupPercent: 35 },
          { name: "天花板", spec: "含維修孔", unit: "坪", quantity: 30, unitCost: 4200, markupPercent: 35 },
        ],
      },
      {
        name: "地板工程",
        icon: "🏠",
        items: [
          { name: "商用地板", spec: "SPC / 塑膠地磚", unit: "坪", quantity: 30, unitCost: 2800, markupPercent: 35 },
        ],
      },
      {
        name: "油漆工程",
        icon: "🎨",
        items: [
          { name: "全室油漆", spec: "", unit: "坪", quantity: 30, unitCost: 2000, markupPercent: 40 },
        ],
      },
    ],
  },
];
