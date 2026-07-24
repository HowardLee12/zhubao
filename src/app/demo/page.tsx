import type { Metadata } from "next";

import { DemoApp } from "@/components/v2/demo-app";

export const metadata: Metadata = {
  title: "Renoly v2 互動原型",
  description: "小型工程與到府服務團隊，從接案、報價、派工到完工的互動產品原型。",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DemoPage() {
  return <DemoApp />;
}

