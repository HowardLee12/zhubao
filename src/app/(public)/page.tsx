import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "築報工程管理 — 裝潢設計師的報價、排程、收款工具",
  description:
    "雙版本報價自動算利潤，工班排程衝突偵測，收款追蹤一目瞭然，施工照片按工種分類。手機直接開，不用裝 APP。",
};

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID ?? "2009506910-kYOGj0kk"}`;

const FEATURES = [
  {
    title: "雙版本報價",
    desc: "填一次自動產出成本版 + 客戶版，利潤即時計算，分享時成本自動隱藏",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: "工班排程",
    desc: "所有案件的工班排在同一頁，撞期自動偵測，不用再靠腦袋記",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: "收款追蹤",
    desc: "每筆收款狀態一目瞭然，到期提醒，不用翻 LINE 找轉帳紀錄",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: "施工照片",
    desc: "按工種分類拍照記錄，管線封起來之前的照片再也不怕找不到",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
];

const PAIN_POINTS = [
  { before: "Excel 報價做兩份，怕傳錯版本", after: "一份報價自動分兩版" },
  { before: "翻 LINE 找轉帳紀錄", after: "收款進度一頁看完" },
  { before: "白板排程改到看不懂", after: "撞期自動偵測提醒" },
  { before: "施工照片散落在相簿裡", after: "按工種、案件分類管理" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="bg-gradient-to-br from-sage-700 to-sage-900 text-white px-6 py-16 text-center">
        <h1 className="text-3xl font-extrabold mb-3 leading-tight">
          築報工程管理
        </h1>
        <p className="text-base opacity-90 mb-2">
          裝潢設計師的報價、排程、收款工具
        </p>
        <p className="text-sm opacity-70 mb-8">
          手機直接開，不用裝 APP
        </p>
        <a
          href={LIFF_URL}
          className="inline-block bg-[#06C755] text-white px-8 py-3.5 rounded-xl font-bold text-base shadow-lg active:scale-[0.98] transition-transform"
        >
          用 LINE 免費開始
        </a>
        <p className="text-xs opacity-50 mt-3">免費版即可使用核心功能</p>
      </section>

      {/* Pain Points */}
      <section className="px-5 py-10">
        <h2 className="text-lg font-bold text-sage-800 text-center mb-6">
          這些困擾你也有嗎？
        </h2>
        <div className="space-y-3">
          {PAIN_POINTS.map((item) => (
            <div
              key={item.before}
              className="bg-card rounded-xl p-4 shadow-sm flex items-start gap-3"
            >
              <div className="shrink-0 mt-0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-sage-600 line-through decoration-sage-300">
                  {item.before}
                </div>
                <div className="text-sm font-semibold text-sage-800 mt-1 flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {item.after}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-5 py-10 bg-sage-50">
        <h2 className="text-lg font-bold text-sage-800 text-center mb-6">
          四大核心功能
        </h2>
        <div className="space-y-4">
          {FEATURES.map((feat) => (
            <div
              key={feat.title}
              className="bg-card rounded-xl p-5 shadow-sm flex gap-4"
            >
              <div className="shrink-0 text-primary mt-0.5">{feat.icon}</div>
              <div>
                <div className="text-base font-bold text-sage-800 mb-1">
                  {feat.title}
                </div>
                <div className="text-sm text-sage-600 leading-relaxed">
                  {feat.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="px-5 py-10">
        <h2 className="text-lg font-bold text-sage-800 text-center mb-6">
          方案
        </h2>
        <div className="space-y-4">
          {/* Free */}
          <div className="bg-card rounded-xl p-5 shadow-sm border border-sage-200">
            <div className="flex justify-between items-center mb-3">
              <span className="text-base font-bold text-sage-800">免費版</span>
              <span className="text-lg font-extrabold text-sage-800">
                NT$0<span className="text-xs font-normal text-sage-500">/月</span>
              </span>
            </div>
            <ul className="space-y-2 text-sm text-sage-600">
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                3 張報價單
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                1 個案件
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                10 張施工照片/案件
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                工班排程 + 收款追蹤
              </li>
            </ul>
          </div>

          {/* Pro */}
          <div className="bg-card rounded-xl p-5 shadow-sm border-2 border-primary relative">
            <div className="absolute -top-3 left-4 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full">
              即將推出
            </div>
            <div className="flex justify-between items-center mb-3 mt-1">
              <span className="text-base font-bold text-sage-800">專業版</span>
              <span className="text-sm text-sage-500">定價規劃中</span>
            </div>
            <ul className="space-y-2 text-sm text-sage-600">
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                無限報價單
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                無限案件管理
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                無限施工照片
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                所有免費版功能
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-12 text-center bg-sage-50">
        <h2 className="text-xl font-bold text-sage-800 mb-2">
          不用再做兩份報價單了
        </h2>
        <p className="text-sm text-sage-600 mb-6">
          免費開始，有 LINE 就能用
        </p>
        <a
          href={LIFF_URL}
          className="inline-block bg-[#06C755] text-white px-8 py-3.5 rounded-xl font-bold text-base shadow-lg active:scale-[0.98] transition-transform"
        >
          用 LINE 免費開始
        </a>
      </section>

      {/* Footer */}
      <footer className="px-5 py-6 text-center text-xs text-sage-400">
        <p>築報工程管理</p>
        <p className="mt-1">
          <Link href="/dashboard" className="underline">登入</Link>
          {" "}·{" "}
          <a href={`mailto:wei00925@gmail.com`} className="underline">聯絡我們</a>
        </p>
      </footer>
    </div>
  );
}
