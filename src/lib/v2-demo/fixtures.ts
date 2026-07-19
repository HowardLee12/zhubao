import type {
  DemoCaseRecord,
  DemoChangeOrder,
  DemoChecklistItem,
  DemoPhoto,
  DemoQuote,
  DemoTechnician,
  DemoTemplate,
  DemoTimelineItem,
  DemoWorkOrder,
} from "./types";

const sharedTechnicians: DemoTechnician[] = [
  {
    id: "tech-chen",
    name: "陳師傅",
    initial: "陳",
    specialty: "冷氣・水電",
    availability: "今日 13:30 後可派",
    hasConflict: false,
  },
  {
    id: "tech-lee",
    name: "李師傅",
    initial: "李",
    specialty: "防水・修繕",
    availability: "14:00–16:00 已有工單",
    hasConflict: true,
  },
];

function serviceCase(): DemoCaseRecord {
  return {
    id: "case-service-001",
    reference: "AC-2026-0716",
    title: "兩台分離式冷氣清洗",
    customerName: "林太太",
    customerInitial: "林",
    phone: "0912 345 678",
    address: "台北市松山區民生東路四段 88 號 7 樓",
    district: "台北市松山區",
    receivedAt: "今天 09:12",
    source: "LINE",
    serviceLabel: "冷氣清洗",
    summary: "客廳冷氣有異味，兩台皆超過一年未清洗，希望週六上午到府。",
    details: ["分離式冷氣 × 2", "可約：週六 09:00–12:00", "大樓有電梯，可臨停"],
    photoCount: 3,
    equipmentLabel: "大金分離式冷氣 × 2",
    ownerName: "林小姐",
  };
}

function projectCase(): DemoCaseRecord {
  return {
    id: "case-project-014",
    reference: "WF-2026-014",
    title: "陽台漏水與防水修繕",
    customerName: "陳先生",
    customerInitial: "陳",
    phone: "0988 210 567",
    address: "新北市板橋區文化路二段 126 巷 8 號 5 樓",
    district: "新北市板橋區",
    receivedAt: "昨天 16:42",
    source: "LINE",
    serviceLabel: "抓漏・防水",
    summary: "大雨後陽台牆角滲水，希望先安排現勘，再提供分階段施工報價。",
    details: ["室內牆角約 1.5m 水痕", "可約：平日 15:00 後", "已有 4 張雨後現況照"],
    photoCount: 4,
    equipmentLabel: "後陽台牆面與地坪",
    ownerName: "王老闆",
  };
}

function serviceQuote(): DemoQuote {
  return {
    reference: "Q-AC-0716-v1",
    version: 1,
    status: "draft",
    validUntil: "2026/07/23",
    humanConfirmed: false,
    customerMessage: "費用包含基本防護、清洗與現場清潔；若現場設備狀況不同，會先說明再施工。",
    lines: [
      {
        id: "line-clean",
        name: "分離式冷氣深層清洗",
        detail: "室內機拆洗、鰭片清潔與基本防護",
        quantity: 2,
        unit: "台",
        unitPrice: 2200,
        internalCost: 1200,
      },
      {
        id: "line-outdoor",
        name: "室外機基礎清潔",
        detail: "同址搭配室內機服務",
        quantity: 2,
        unit: "台",
        unitPrice: 400,
        internalCost: 100,
      },
    ],
  };
}

function projectQuote(): DemoQuote {
  return {
    reference: "Q-WF-014-v1",
    version: 1,
    status: "draft",
    validUntil: "2026/07/30",
    humanConfirmed: false,
    customerMessage: "報價含基面整理、防水層與試水；拆除後若發現隱蔽損壞，會另提追加簽認。",
    lines: [
      {
        id: "line-site",
        name: "現勘與含水檢測",
        detail: "現況判讀、含水檢測與施工範圍確認",
        quantity: 1,
        unit: "式",
        unitPrice: 5000,
        internalCost: 2400,
      },
      {
        id: "line-proof",
        name: "陽台基面整理與防水工程",
        detail: "約 12 坪，含裂縫補強、兩道防水與試水",
        quantity: 1,
        unit: "式",
        unitPrice: 63000,
        internalCost: 36800,
      },
    ],
  };
}

function workOrder(template: DemoTemplate): DemoWorkOrder {
  return template === "service"
    ? {
        reference: "WO-0716-03",
        title: "冷氣清洗到府服務",
        status: "unscheduled",
        dateLabel: "7/18（六）",
        timeWindow: "09:00–11:30",
        duration: "預估 2.5 小時",
        assigneeId: "tech-chen",
        assigneeName: "陳師傅",
        assigneeInitial: "陳",
      }
    : {
        reference: "WO-0719-01",
        title: "防水第一階段施工",
        status: "unscheduled",
        dateLabel: "7/20（一）",
        timeWindow: "08:30–16:30",
        duration: "預估 8 小時",
        assigneeId: "tech-chen",
        assigneeName: "陳師傅",
        assigneeInitial: "陳",
      };
}

function checklist(template: DemoTemplate): DemoChecklistItem[] {
  return template === "service"
    ? [
        { id: "power", label: "運轉與斷電確認", hint: "記錄清洗前冷房狀況", complete: false },
        { id: "drain", label: "排水與漏水檢查", hint: "確認排水暢通、接水盤無異常", complete: false },
        { id: "result", label: "復機測試完成", hint: "記錄出風與客戶可見建議", complete: false },
      ]
    : [
        { id: "moisture", label: "基面含水確認", hint: "記錄施工前含水與天候", complete: false },
        { id: "cracks", label: "裂縫補強完成", hint: "確認補強範圍與材料", complete: false },
        { id: "coating", label: "防水層紀錄", hint: "記錄道數、厚度與養護時間", complete: false },
      ];
}

function photos(template: DemoTemplate): DemoPhoto[] {
  const subject = template === "service" ? "客廳室內機" : "陽台牆角";
  return [
    {
      id: `${template}-before`,
      kind: "before",
      label: "施工前",
      caption: `${subject}・待加入示範照`,
      added: false,
    },
    {
      id: `${template}-after`,
      kind: "after",
      label: "施工後",
      caption: `${subject}・待加入示範照`,
      added: false,
    },
  ];
}

function changeOrder(): DemoChangeOrder {
  return {
    reference: "CO-WF-014-01",
    title: "拆除後基底補強",
    reason: "拆除舊層後發現牆角基底粉化，需先補強再施作防水層。",
    amount: 8000,
    delayDays: 1,
    status: "draft",
    proofLabel: "拆除後基底現況・2 張證據照",
  };
}

function timeline(template: DemoTemplate): DemoTimelineItem[] {
  const item = template === "service" ? "LINE 需求已進入接案匣" : "抓漏需求已進入接案匣";
  return [
    {
      id: "event-intake",
      title: item,
      detail: "系統保留原始訊息、聯絡方式與照片",
      time: template === "service" ? "今天 09:12" : "昨天 16:42",
      tone: "orange",
    },
  ];
}

export function createDemoFixture(template: DemoTemplate) {
  return {
    caseRecord: template === "service" ? serviceCase() : projectCase(),
    quote: template === "service" ? serviceQuote() : projectQuote(),
    workOrder: workOrder(template),
    technicians: sharedTechnicians.map((technician) => ({ ...technician })),
    checklist: checklist(template),
    photos: photos(template),
    changeOrder: template === "project" ? changeOrder() : null,
    timeline: timeline(template),
  };
}

