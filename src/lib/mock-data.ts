import { Project, Quote } from "./types";

export const mockProjects: Project[] = [
  {
    id: "p1",
    customerName: "林先生",
    address: "信義路三段28號4F",
    description: "3房2廳全室裝修",
    totalAmount: 1800000,
    status: "in_progress",
    progress: 45,
    trades: [
      { id: "t1", name: "拆除清運", startDate: "2026-03-01", endDate: "2026-03-03", status: "done", crew: "阿國拆除" },
      { id: "t2", name: "水電配管", startDate: "2026-03-04", endDate: "2026-03-08", status: "done", crew: "張水電" },
      { id: "t3", name: "鋁窗安裝", startDate: "2026-03-09", endDate: "2026-03-10", status: "done", crew: "永興鋁窗" },
      { id: "t4", name: "泥作貼磚", startDate: "2026-03-11", endDate: "2026-03-18", status: "active", crew: "陳師傅" },
      { id: "t5", name: "木作工程", startDate: "2026-03-20", endDate: "2026-03-28", status: "pending", crew: "大胖木工" },
      { id: "t6", name: "油漆工程", startDate: "2026-03-30", endDate: "2026-04-03", status: "pending", crew: "阿明師" },
      { id: "t7", name: "清潔驗收", startDate: "2026-04-05", endDate: "2026-04-05", status: "pending", crew: "待排" },
    ],
    payments: [
      { id: "pay1", name: "簽約訂金", percentage: 30, amount: 540000, dueDate: "2026-02-20", status: "paid", paidDate: "2026-02-20" },
      { id: "pay2", name: "泥作完工", percentage: 20, amount: 360000, dueDate: "2026-03-18", status: "due" },
      { id: "pay3", name: "木作完工", percentage: 20, amount: 360000, dueDate: "2026-03-28", status: "pending" },
      { id: "pay4", name: "驗收尾款", percentage: 30, amount: 540000, dueDate: "2026-04-05", status: "pending" },
    ],
    createdAt: "2026-02-15",
  },
  {
    id: "p2",
    customerName: "張小姐",
    address: "復興南路一段120號12F",
    description: "廚房+主臥翻新",
    totalAmount: 650000,
    status: "in_progress",
    progress: 75,
    trades: [
      { id: "t8", name: "拆除", startDate: "2026-02-20", endDate: "2026-02-21", status: "done", crew: "阿國拆除" },
      { id: "t9", name: "水電", startDate: "2026-02-24", endDate: "2026-02-26", status: "done", crew: "張水電" },
      { id: "t10", name: "泥作", startDate: "2026-02-27", endDate: "2026-03-05", status: "done", crew: "陳師傅" },
      { id: "t11", name: "廚具安裝", startDate: "2026-03-13", endDate: "2026-03-15", status: "active", crew: "永盛廚具" },
      { id: "t12", name: "油漆+清潔", startDate: "2026-03-17", endDate: "2026-03-19", status: "pending", crew: "阿明師" },
    ],
    payments: [
      { id: "pay5", name: "簽約訂金", percentage: 30, amount: 195000, dueDate: "2026-02-15", status: "paid", paidDate: "2026-02-15" },
      { id: "pay6", name: "泥作完工", percentage: 30, amount: 195000, dueDate: "2026-03-06", status: "paid", paidDate: "2026-03-06" },
      { id: "pay7", name: "廚具完工", percentage: 20, amount: 130000, dueDate: "2026-03-15", status: "due" },
      { id: "pay8", name: "驗收尾款", percentage: 20, amount: 130000, dueDate: "2026-03-19", status: "pending" },
    ],
    createdAt: "2026-02-10",
  },
  {
    id: "p3",
    customerName: "陳先生",
    address: "民生東路五段88號3F",
    description: "新成屋客變",
    totalAmount: 2200000,
    status: "planning",
    progress: 0,
    trades: [],
    payments: [
      { id: "pay9", name: "設計訂金", percentage: 10, amount: 220000, dueDate: "2026-03-01", status: "paid", paidDate: "2026-03-01" },
      { id: "pay10", name: "開工款", percentage: 20, amount: 440000, dueDate: "2026-04-01", status: "upcoming" },
      { id: "pay11", name: "中期款", percentage: 30, amount: 660000, dueDate: "", status: "pending" },
      { id: "pay12", name: "驗收尾款", percentage: 40, amount: 880000, dueDate: "", status: "pending" },
    ],
    createdAt: "2026-02-28",
  },
];

export const mockQuote: Quote = {
  id: "q1",
  projectId: "p1",
  customerName: "林先生",
  address: "信義路三段28號4F",
  version: 3,
  createdAt: "2026-02-15",
  sections: [
    {
      id: "s1",
      name: "拆除工程",
      icon: "🔨",
      items: [
        { id: "i1", name: "全室地磚拆除", spec: "約32坪", unit: "坪", quantity: 32, unitCost: 1100, markupPercent: 36 },
        { id: "i2", name: "隔間拆除", spec: "2面牆 含清運", unit: "式", quantity: 1, unitCost: 15000, markupPercent: 47 },
        { id: "i3", name: "廢棄物清運", spec: "3車次", unit: "車", quantity: 3, unitCost: 3800, markupPercent: 32 },
      ],
    },
    {
      id: "s2",
      name: "水電工程",
      icon: "💡",
      items: [
        { id: "i4", name: "全室重新配線", spec: "含開關插座36組", unit: "式", quantity: 1, unitCost: 68000, markupPercent: 40 },
        { id: "i5", name: "冷熱水管更換", spec: "不鏽鋼管", unit: "式", quantity: 1, unitCost: 38000, markupPercent: 45 },
        { id: "i6", name: "排水管路", spec: "含浴室地排2組", unit: "式", quantity: 1, unitCost: 22000, markupPercent: 36 },
      ],
    },
    {
      id: "s3",
      name: "泥作工程",
      icon: "🧱",
      items: [
        { id: "i7", name: "地磚鋪設", spec: "60x60拋光磚 約32坪", unit: "坪", quantity: 32, unitCost: 3600, markupPercent: 39 },
        { id: "i8", name: "浴室壁磚+地磚", spec: "2間浴室", unit: "式", quantity: 1, unitCost: 65000, markupPercent: 46 },
        { id: "i9", name: "防水工程", spec: "浴室+陽台", unit: "式", quantity: 1, unitCost: 45000, markupPercent: 44 },
      ],
    },
    {
      id: "s4",
      name: "木作工程",
      icon: "🪵",
      items: [
        { id: "i10", name: "客廳電視牆", spec: "含燈帶、石材飾面", unit: "式", quantity: 1, unitCost: 82000, markupPercent: 46 },
        { id: "i11", name: "全室天花板", spec: "含間接照明", unit: "式", quantity: 1, unitCost: 128000, markupPercent: 45 },
        { id: "i12", name: "主臥衣櫃", spec: "8尺系統櫃", unit: "式", quantity: 1, unitCost: 65000, markupPercent: 46 },
        { id: "i13", name: "鞋櫃+玄關", spec: "含穿鞋椅", unit: "式", quantity: 1, unitCost: 55000, markupPercent: 45 },
      ],
    },
    {
      id: "s5",
      name: "油漆+其他",
      icon: "🎨",
      items: [
        { id: "i14", name: "全室油漆", spec: "得利乳膠漆 3底2面", unit: "式", quantity: 1, unitCost: 58000, markupPercent: 47 },
        { id: "i15", name: "鋁窗更換", spec: "氣密窗4組", unit: "組", quantity: 4, unitCost: 12500, markupPercent: 44 },
        { id: "i16", name: "清潔工程", spec: "粗清+細清", unit: "式", quantity: 1, unitCost: 12000, markupPercent: 50 },
        { id: "i17", name: "設計費", spec: "32坪", unit: "坪", quantity: 32, unitCost: 3000, markupPercent: 0 },
      ],
    },
  ],
};
